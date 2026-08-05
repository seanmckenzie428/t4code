import {
  APP_COMMAND_CATALOG,
  getAppCommandCatalogEntry,
} from "@t3tools/client-runtime/app-control";
import {
  type AppCommandDescriptor,
  type AppCommandInvocation,
  type AppCommandResult,
  type AppControlError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as NodeCrypto from "node:crypto";

import * as AppControlBroker from "./AppControlBroker.ts";
import { AppControlAudit } from "./AppControlAudit.ts";
import * as AppControlServerExecutor from "./AppControlServerExecutor.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

type Scope = McpInvocationContext.McpInvocationScope & {
  readonly principal: NonNullable<McpInvocationContext.McpInvocationScope["principal"]>;
};

export interface AppControlPolicyInput {
  readonly scope: Scope;
  readonly invocation: AppCommandInvocation;
}

export class AppControlPolicy extends Context.Service<
  AppControlPolicy,
  { readonly invoke: (input: AppControlPolicyInput) => Effect.Effect<AppCommandResult> }
>()("t3/mcp/AppControlPolicy") {}

interface CompletedAction {
  readonly commandId: string;
  readonly argsKey: string;
  readonly result: AppCommandResult;
}

interface InFlightAction {
  readonly commandId: string;
  readonly argsKey: string;
  readonly deferred: Deferred.Deferred<AppCommandResult, never>;
}

type ActionState =
  | { readonly state: "in-flight"; readonly action: InFlightAction }
  | { readonly state: "completed"; readonly action: CompletedAction };
type ActionClaim = ActionState | { readonly state: "leader"; readonly action: InFlightAction };

const hashProjectScriptCommand = (command: string): string =>
  NodeCrypto.createHash("sha256").update(command, "utf8").digest("hex");

// Idempotency only needs a recent replay window. Keeping every completed action
// for the lifetime of the server makes a long-running environment grow without
// bound. In-flight entries are never evicted.
export const APP_CONTROL_COMPLETED_ACTION_LIMIT = 512;

const trimCompletedActions = (
  actions: ReadonlyMap<string, ActionState>,
): ReadonlyMap<string, ActionState> => {
  let completed = 0;
  for (const action of actions.values()) {
    if (action.state === "completed") completed += 1;
  }
  if (completed <= APP_CONTROL_COMPLETED_ACTION_LIMIT) return actions;
  const next = new Map(actions);
  for (const [key, action] of next) {
    if (action.state !== "completed") continue;
    next.delete(key);
    completed -= 1;
    if (completed <= APP_CONTROL_COMPLETED_ACTION_LIMIT) break;
  }
  return next;
};

const forbiddenCommandIds = new Set([
  "approval.respond",
  "approval.resolve",
  "user-input.respond",
  "user-input.resolve",
  "thread.approval.respond",
  "thread.user-input.respond",
  "capability-grant.mutate",
]);

const explicitConfirmationIds = new Set([
  "project.clone",
  "project.delete",
  "thread.delete",
  "thread.checkpoint.revert",
  "terminal.command.run",
  "source-control.checkout",
  "source-control.publish",
  "source-control.change-request.create",
  "view.delete",
]);

const error = (code: AppControlError["code"], message: string): AppControlError => ({
  code,
  message,
  retryable: code === "disconnected" || code === "timeout",
});

const failed = (invocation: AppCommandInvocation, cause: AppControlError): AppCommandResult => ({
  status: "failed",
  actionId: invocation.actionId,
  error: cause,
});

const recordArgs = (args: unknown): Readonly<Record<string, unknown>> =>
  Predicate.isObject(args) && !Array.isArray(args) ? args : {};

const checkScope = (
  scope: Scope,
  invocation: AppCommandInvocation,
): AppControlError | undefined => {
  const args = recordArgs(invocation.args);
  if (typeof args.environmentId === "string" && args.environmentId !== scope.environmentId) {
    return error("forbidden", "Cross-environment app control is not permitted.");
  }
  if (
    (invocation.commandId === "script.run" || invocation.commandId === "script.import") &&
    scope.principal.kind !== "thread-agent"
  ) {
    return error("forbidden", "Project scripts require a project thread agent.");
  }
  if (scope.principal.kind === "global-assistant") return undefined;
  if (typeof args.projectId === "string" && args.projectId !== scope.principal.projectId) {
    return error("forbidden", "Thread agents cannot control another project.");
  }
  if (typeof args.threadId === "string" && args.threadId !== scope.principal.threadId) {
    return error("forbidden", "Thread agents cannot control another thread.");
  }
  return undefined;
};

const scriptGrant = (invocation: AppCommandInvocation): string | undefined => {
  if (invocation.commandId !== "script.run") return undefined;
  const args = recordArgs(invocation.args);
  return typeof args.scriptId === "string" && typeof args.commandHash === "string"
    ? `script:${args.scriptId}:${args.commandHash}`
    : undefined;
};

const requiresGrant = (descriptor: AppCommandDescriptor): boolean =>
  descriptor.risk === "mutate" && descriptor.requiredGrant !== null;

const requiresConfirmation = (
  descriptor: AppCommandDescriptor,
  scope: Scope,
  invocation: AppCommandInvocation,
): boolean => {
  if (explicitConfirmationIds.has(descriptor.id)) return true;
  if (descriptor.risk === "destructive") return true;
  if (descriptor.risk !== "external") return false;
  const grant = scriptGrant(invocation);
  return grant === undefined || !scope.grants.has(grant);
};

export type AppControlAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "confirm" }
  | { readonly status: "deny"; readonly error: AppControlError };

export const evaluateAppControlAccess = (
  input: AppControlPolicyInput,
): AppControlAccessDecision => {
  const invocation = input.invocation;
  const descriptor = getAppCommandCatalogEntry(invocation.commandId)?.descriptor;
  if (
    descriptor === undefined ||
    descriptor.risk === "forbidden" ||
    forbiddenCommandIds.has(invocation.commandId)
  ) {
    return {
      status: "deny",
      error: error("forbidden", "This command is not available to agents."),
    };
  }
  const scopeError = checkScope(input.scope, invocation);
  if (scopeError !== undefined) return { status: "deny", error: scopeError };
  if (requiresGrant(descriptor) && !input.scope.grants.has(descriptor.requiredGrant as string)) {
    return {
      status: "deny",
      error: error("forbidden", `This provider session lacks grant ${descriptor.requiredGrant}.`),
    };
  }
  return requiresConfirmation(descriptor, input.scope, invocation)
    ? { status: "confirm" }
    : { status: "allow" };
};

export const make = Effect.gen(function* AppControlPolicyMake() {
  const broker = yield* AppControlBroker.AppControlBroker;
  const appControlAudit = yield* AppControlAudit;
  const serverExecutor = yield* AppControlServerExecutor.AppControlServerExecutor;
  const projections = yield* ProjectionSnapshotQuery;
  const actions = yield* SynchronizedRef.make<ReadonlyMap<string, ActionState>>(new Map());

  const validateImportedScript = Effect.fn("AppControlPolicy.validateImportedScript")(function* (
    input: AppControlPolicyInput,
  ) {
    if (input.invocation.commandId !== "script.run") return;
    if (input.scope.principal.kind !== "thread-agent") {
      return yield* Effect.fail(
        error("forbidden", "Project scripts require a project thread agent."),
      );
    }
    const args = recordArgs(input.invocation.args);
    if (typeof args.scriptId !== "string" || args.scriptId.trim() === "") {
      return yield* Effect.fail(error("invalid-input", "A project script ID is required."));
    }
    const thread = yield* projections
      .getThreadShellById(input.scope.principal.threadId)
      .pipe(Effect.mapError(() => error("unavailable", "Project state is unavailable.")));
    if (Option.isNone(thread) || thread.value.projectId !== input.scope.principal.projectId) {
      return yield* Effect.fail(error("forbidden", "The current project thread is unavailable."));
    }
    const project = yield* projections
      .getProjectShellById(input.scope.principal.projectId)
      .pipe(Effect.mapError(() => error("unavailable", "Project state is unavailable.")));
    if (Option.isNone(project) || project.value.kind !== "workspace") {
      return yield* Effect.fail(
        error("forbidden", "Project scripts require a current workspace project."),
      );
    }
    const script = project.value.scripts.find((candidate) => candidate.id === args.scriptId);
    if (script === undefined) {
      return yield* Effect.fail(
        error("invalid-input", "The imported project script does not exist."),
      );
    }
    if (
      args.commandHash !== undefined &&
      (typeof args.commandHash !== "string" ||
        args.commandHash !== hashProjectScriptCommand(script.command))
    ) {
      return yield* Effect.fail(
        error("conflict", "The imported project script changed. Review it before running."),
      );
    }
    return hashProjectScriptCommand(script.command);
  });

  const confirmationFor = Effect.fn("AppControlPolicy.confirmationFor")(function* (
    descriptor: AppCommandDescriptor,
    input: AppControlPolicyInput,
  ) {
    const args = recordArgs(input.invocation.args);
    let targetName = descriptor.title;
    let descendants: number | undefined;
    if (descriptor.id === "project.action.upsert") {
      const action = Predicate.isObject(args.action) ? args.action : {};
      const name = typeof action.name === "string" ? action.name : "project action";
      const target =
        typeof action.url === "string"
          ? action.url
          : typeof action.scriptId === "string"
            ? `saved terminal action ${action.scriptId}`
            : "unknown target";
      targetName = `${name}: ${target}`;
    } else if (descriptor.id === "project.action.delete") {
      const actionId = typeof args.actionId === "string" ? args.actionId : "unknown";
      if (typeof args.projectId === "string") {
        const project = yield* projections
          .getProjectShellById(args.projectId as never)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        const action = Option.isSome(project)
          ? (project.value.customActions ?? []).find((candidate) => candidate.id === actionId)
          : undefined;
        targetName = action?.name ?? `project action ${actionId}`;
      }
    } else if (typeof args.projectId === "string") {
      const project = yield* projections
        .getProjectShellById(args.projectId as never)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      targetName = Option.isSome(project) ? project.value.title : `project ${args.projectId}`;
      if (descriptor.id === "project.delete") {
        const snapshot = yield* projections.getShellSnapshot().pipe(Effect.option);
        descendants = Option.isSome(snapshot)
          ? snapshot.value.threads.filter((thread) => thread.projectId === args.projectId).length
          : undefined;
      }
    } else if (typeof args.threadId === "string") {
      const thread = yield* projections
        .getThreadShellById(args.threadId as never)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      targetName = Option.isSome(thread) ? thread.value.title : `thread ${args.threadId}`;
    } else if (descriptor.id === "terminal.command.run") {
      targetName = typeof args.command === "string" ? args.command : "one-shot terminal command";
    } else if (descriptor.id === "script.run") {
      const scriptId = typeof args.scriptId === "string" ? args.scriptId : "unknown";
      if (input.scope.principal.kind === "thread-agent") {
        const project = yield* projections
          .getProjectShellById(input.scope.principal.projectId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        const script = Option.isSome(project)
          ? project.value.scripts.find((candidate) => candidate.id === scriptId)
          : undefined;
        targetName = script === undefined ? `project script ${scriptId}` : script.name;
      } else {
        targetName = `project script ${scriptId}`;
      }
    } else if (descriptor.id === "script.import") {
      const script = Predicate.isObject(args.script) ? args.script : {};
      const scriptId = typeof script.id === "string" ? script.id : "unknown";
      const command = typeof script.command === "string" ? script.command : "unknown command";
      targetName = `${scriptId}: ${command}`;
    } else if (descriptor.id === "ui.external-url.open") {
      targetName = typeof args.url === "string" ? args.url : "external URL";
    } else if (descriptor.domain === "source-control") {
      targetName = "current repository";
    }
    return {
      title: descriptor.title,
      description:
        descriptor.risk === "destructive"
          ? "This action can remove or replace project data and must be approved for this call."
          : "This action affects resources outside ordinary T3 navigation and must be approved for this call.",
      risk: descriptor.risk === "destructive" ? ("destructive" as const) : ("external" as const),
      targetName,
      environmentId: input.scope.environmentId,
      ...(descendants === undefined ? {} : { descendants }),
      recoverability:
        descriptor.risk === "destructive"
          ? "Recovery is not guaranteed. Review the exact target before allowing."
          : "The external effect may not be reversible from T3.",
      rememberAllowed: false as const,
    };
  });

  const invoke: AppControlPolicy["Service"]["invoke"] = Effect.fn("AppControlPolicy.invoke")(
    function* (input) {
      const requestedInvocation = input.invocation;
      const descriptor = getAppCommandCatalogEntry(requestedInvocation.commandId)?.descriptor;
      const audit = (status: "requested" | "completed" | "failed" | "declined") =>
        appControlAudit.record({
          scope: input.scope,
          invocation: requestedInvocation,
          descriptor,
          status,
        });
      yield* audit("requested");
      const scriptValidation = yield* validateImportedScript(input).pipe(Effect.result);
      if (Result.isFailure(scriptValidation)) {
        yield* audit("failed");
        return failed(requestedInvocation, scriptValidation.failure);
      }
      const invocation =
        scriptValidation.success === undefined
          ? requestedInvocation
          : {
              ...requestedInvocation,
              args: {
                ...recordArgs(requestedInvocation.args),
                commandHash: scriptValidation.success,
              },
            };
      const normalizedInput = { ...input, invocation };
      const access = evaluateAppControlAccess(normalizedInput);
      if (access.status === "deny") {
        yield* audit("failed");
        return failed(invocation, access.error);
      }
      if (descriptor === undefined) {
        return failed(invocation, error("forbidden", "This command is not available to agents."));
      }
      if (invocation.expectedRevision !== undefined) {
        const revision = yield* projections.getSnapshotSequence().pipe(Effect.option);
        if (
          Option.isNone(revision) ||
          revision.value.snapshotSequence !== invocation.expectedRevision
        ) {
          yield* audit("failed");
          return failed(invocation, error("conflict", "The target revision changed."));
        }
      }
      const actionKey = `${input.scope.providerSessionId}\u0000${invocation.actionId}`;
      const argsKey = yield* Schema.encodeEffect(Schema.UnknownFromJsonString)(
        invocation.args,
      ).pipe(Effect.orElseSucceed(() => "<invalid-json>"));
      const deferred = yield* Deferred.make<AppCommandResult, never>();
      const claim = yield* SynchronizedRef.modify<ReadonlyMap<string, ActionState>, ActionClaim>(
        actions,
        (current) => {
          const previous = current.get(actionKey);
          if (previous !== undefined) return [previous, current] as const;
          const action: InFlightAction = {
            commandId: invocation.commandId,
            argsKey,
            deferred,
          };
          return [
            { state: "leader" as const, action },
            new Map(current).set(actionKey, { state: "in-flight", action }),
          ] as const;
        },
      );
      if (claim.state !== "leader") {
        if (claim.action.commandId !== invocation.commandId || claim.action.argsKey !== argsKey) {
          yield* audit("failed");
          return failed(
            invocation,
            error("conflict", "Action ID was already used for different input."),
          );
        }
        if (claim.state === "in-flight") return yield* Deferred.await(claim.action.deferred);
        if (claim.action.result.status !== "completed") return claim.action.result;
        return {
          ...claim.action.result,
          receipt: { ...claim.action.result.receipt, idempotentReplay: true },
        };
      }

      const executeOnce = Effect.gen(function* () {
        if (access.status === "confirm") {
          const confirmation = yield* confirmationFor(descriptor, normalizedInput);
          const decision = yield* broker
            .invoke<{ readonly decision?: "allow" | "decline" }>({
              scope: input.scope,
              invocation,
              confirmation,
            })
            .pipe(Effect.result);
          if (Result.isFailure(decision)) return failed(invocation, decision.failure);
          if (decision.success.decision !== "allow") {
            return { status: "declined" as const, actionId: invocation.actionId };
          }
        }

        if (descriptor.owner === "server") {
          return yield* serverExecutor.execute(normalizedInput);
        }
        const routed = yield* broker
          .invoke<AppCommandResult>({ scope: input.scope, invocation })
          .pipe(Effect.result);
        return Result.isFailure(routed) ? failed(invocation, routed.failure) : routed.success;
      });
      const result = yield* executeOnce.pipe(
        Effect.onInterrupt(() =>
          Deferred.succeed(
            deferred,
            failed(invocation, error("disconnected", "App-control invocation was interrupted.")),
          ),
        ),
      );
      yield* SynchronizedRef.update(actions, (current) => {
        const previous = current.get(actionKey);
        if (previous?.state !== "in-flight" || previous.action.deferred !== deferred)
          return current;
        const next = new Map(current);
        if (result.status === "completed" || result.status === "declined") {
          next.set(actionKey, {
            state: "completed",
            action: { commandId: invocation.commandId, argsKey, result },
          });
        } else {
          next.delete(actionKey);
        }
        return trimCompletedActions(next);
      });
      yield* Deferred.succeed(deferred, result);
      yield* audit(result.status === "completed" ? "completed" : result.status);
      return result;
    },
  );

  return AppControlPolicy.of({ invoke });
});

export const layer = Layer.effect(AppControlPolicy, make);

export const descriptors = APP_COMMAND_CATALOG.map(({ descriptor }) => descriptor);
