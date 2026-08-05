import {
  CommandId,
  IsoDateTime,
  MessageId,
  MAX_SCRIPT_ID_LENGTH,
  ModelSelection,
  NonNegativeInt,
  ProjectId,
  ProviderInteractionMode,
  ProjectScript,
  ProjectCustomAction,
  ProjectCustomActionIcon,
  ThreadId,
  TrimmedNonEmptyString,
  type AppCommandInvocation,
  type AppCommandResult,
  type AppControlError,
  type AppActionReceipt,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { AppControlTerminalCommandRunner } from "./AppControlTerminalCommandRunner.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import {
  MAX_CONCURRENT_ASSISTANT_DELEGATIONS,
  activeDelegatedTurnCount,
  validateDelegationPrincipal,
  validateDelegationTarget,
} from "./AppControlDelegation.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";

type Scope = McpInvocationContext.McpInvocationScope & {
  readonly principal: NonNullable<McpInvocationContext.McpInvocationScope["principal"]>;
};

export interface AppControlServerExecutionInput {
  readonly scope: Scope;
  readonly invocation: AppCommandInvocation;
}

export class AppControlServerExecutor extends Context.Service<
  AppControlServerExecutor,
  {
    readonly execute: (input: AppControlServerExecutionInput) => Effect.Effect<AppCommandResult>;
  }
>()("t3/mcp/AppControlServerExecutor") {}

const ProjectCreateArgs = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
});
const ProjectRenameArgs = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
});
const ProjectDeleteArgs = Schema.Struct({
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});
const ThreadIdArgs = Schema.Struct({ threadId: ThreadId });
const ThreadRenameArgs = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
});
const ThreadSnoozeArgs = Schema.Struct({
  threadId: ThreadId,
  until: IsoDateTime,
});
const ThreadModelArgs = Schema.Struct({ threadId: ThreadId, modelSelection: ModelSelection });
const ThreadModeArgs = Schema.Struct({ threadId: ThreadId, mode: ProviderInteractionMode });
const ThreadRevertArgs = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});
const DelegationCreateArgs = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
});
const DelegationStartArgs = Schema.Struct({
  threadId: ThreadId,
  text: TrimmedNonEmptyString,
});
const TerminalCommandArgs = Schema.Struct({
  command: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
const ProjectScriptId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
const ProjectScriptImportArgs = Schema.Struct({
  projectId: ProjectId,
  script: Schema.Struct({
    id: ProjectScriptId,
    name: TrimmedNonEmptyString,
    command: TrimmedNonEmptyString,
    icon: Schema.optional(ProjectScript.fields.icon),
    runOnWorktreeCreate: Schema.optional(Schema.Boolean),
    previewUrl: Schema.optional(TrimmedNonEmptyString),
    autoOpenPreview: Schema.optional(Schema.Boolean),
  }),
});
const ProjectActionUpsertArgs = Schema.Struct({
  projectId: ProjectId,
  action: Schema.Struct({
    id: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    icon: Schema.optional(ProjectCustomActionIcon),
    commandId: Schema.Literals(["ui.external-url.open", "script.run"]),
    url: Schema.optional(TrimmedNonEmptyString),
    scriptId: Schema.optional(ProjectScriptId),
  }),
});
const ProjectActionDeleteArgs = Schema.Struct({
  projectId: ProjectId,
  actionId: TrimmedNonEmptyString,
});
const controlError = (code: AppControlError["code"], message: string): AppControlError => ({
  code,
  message,
  retryable: false,
});

const failed = (invocation: AppCommandInvocation, cause: AppControlError): AppCommandResult => ({
  status: "failed",
  actionId: invocation.actionId,
  error: cause,
});

const projectScriptsEqual = (left: ProjectScript, right: ProjectScript): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.command === right.command &&
  left.icon === right.icon &&
  left.runOnWorktreeCreate === right.runOnWorktreeCreate &&
  left.previewUrl === right.previewUrl &&
  left.autoOpenPreview === right.autoOpenPreview &&
  left.showInToolbar === right.showInToolbar;

const decodeArgs = <S extends Schema.Top>(
  schema: S,
  args: unknown,
): Effect.Effect<S["Type"], AppControlError, S["DecodingServices"]> =>
  Schema.decodeUnknownEffect(schema)(args).pipe(
    Effect.mapError(() => controlError("invalid-input", "Command arguments are invalid.")),
  );

export const make = Effect.gen(function* AppControlServerExecutorMake() {
  const engine = yield* OrchestrationEngineService;
  const projections = yield* Effect.serviceOption(ProjectionSnapshotQuery);
  const settings = yield* Effect.serviceOption(ServerSettingsService);
  const terminalCommands = yield* AppControlTerminalCommandRunner;

  const execute: AppControlServerExecutor["Service"]["execute"] = Effect.fn(
    "AppControlServerExecutor.execute",
  )(function* ({ scope, invocation }) {
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const commandId = CommandId.make(
      `app-control:${scope.providerSessionId}:${invocation.actionId}`,
    );
    const decode = <S extends Schema.Top>(schema: S) => decodeArgs(schema, invocation.args);
    if (invocation.commandId === "terminal.command.run") {
      if (scope.principal.kind !== "thread-agent") {
        return failed(
          invocation,
          controlError("forbidden", "One-shot terminal commands require a project thread agent."),
        );
      }
      if (Option.isNone(projections)) {
        return failed(invocation, controlError("unavailable", "Project state is unavailable."));
      }
      const args = yield* decode(TerminalCommandArgs).pipe(Effect.result);
      if (args._tag === "Failure") return failed(invocation, args.failure);
      const thread = yield* projections.value
        .getThreadShellById(scope.principal.threadId)
        .pipe(Effect.result);
      if (
        thread._tag === "Failure" ||
        Option.isNone(thread.success) ||
        thread.success.value.projectId !== scope.principal.projectId
      ) {
        return failed(
          invocation,
          controlError("forbidden", "The current project thread is unavailable."),
        );
      }
      const project = yield* projections.value
        .getProjectShellById(scope.principal.projectId)
        .pipe(Effect.result);
      if (
        project._tag === "Failure" ||
        Option.isNone(project.success) ||
        project.success.value.kind !== "workspace"
      ) {
        return failed(
          invocation,
          controlError("forbidden", "Terminal commands require a current workspace project."),
        );
      }
      const output = yield* terminalCommands
        .run({
          command: args.success.command,
          allowedRoot: thread.success.value.worktreePath ?? project.success.value.workspaceRoot,
          ...(args.success.cwd === undefined ? {} : { cwd: args.success.cwd }),
        })
        .pipe(Effect.result);
      if (output._tag === "Failure") return failed(invocation, output.failure);
      const receipt: AppActionReceipt = {
        receiptId: `app-control-receipt:${scope.providerSessionId}:${invocation.actionId}`,
        actionId: invocation.actionId,
        commandId: invocation.commandId,
        completedAt: createdAt,
        idempotentReplay: false,
      };
      return { status: "completed", receipt, result: output.success };
    }
    const command = yield* Effect.gen(function* () {
      if (invocation.commandId.startsWith("delegation.")) {
        const principalError = validateDelegationPrincipal(scope.principal);
        if (principalError !== undefined) {
          return yield* Effect.fail(controlError("forbidden", principalError));
        }
        if (Option.isNone(settings) || Option.isNone(projections)) {
          return yield* Effect.fail(
            controlError("unavailable", "Delegation services are unavailable."),
          );
        }
        const currentSettings = yield* settings.value.getSettings.pipe(
          Effect.mapError(() =>
            controlError("unavailable", "Delegation settings are unavailable."),
          ),
        );
        if (!currentSettings.globalAssistant.delegationEnabled) {
          return yield* Effect.fail(
            controlError("forbidden", "Project delegation is not enabled for this environment."),
          );
        }
      }
      switch (invocation.commandId) {
        case "delegation.thread.create": {
          const args = yield* decode(DelegationCreateArgs);
          if (scope.principal.kind !== "global-assistant") {
            return yield* Effect.fail(controlError("forbidden", "Delegation requires Quick Chat."));
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Project state is unavailable."));
          }
          const project = yield* projections.value
            .getProjectShellById(args.projectId)
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Project state is unavailable.")),
            );
          if (Option.isNone(project) || project.value.kind !== "workspace") {
            return yield* Effect.fail(
              controlError("invalid-input", "Delegation project does not exist."),
            );
          }
          const modelSelection = project.value.defaultModelSelection;
          if (modelSelection === null) {
            return yield* Effect.fail(
              controlError("invalid-input", "Delegation project has no default model selection."),
            );
          }
          return {
            type: "thread.create" as const,
            commandId,
            threadId: ThreadId.make(`delegated:${invocation.actionId}`),
            projectId: args.projectId,
            kind: "project" as const,
            title: args.title ?? "Delegated by Quick Chat",
            modelSelection,
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
            branch: null,
            worktreePath: null,
            createdAt,
          };
        }
        case "delegation.turn.start": {
          const args = yield* decode(DelegationStartArgs);
          if (scope.principal.kind !== "global-assistant") {
            return yield* Effect.fail(controlError("forbidden", "Delegation requires Quick Chat."));
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Thread state is unavailable."));
          }
          const snapshot = yield* projections.value
            .getSnapshot()
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Thread state is unavailable.")),
            );
          const target = snapshot.threads.find((thread) => thread.id === args.threadId);
          const targetError = validateDelegationTarget({ principal: scope.principal, target });
          if (targetError !== undefined) {
            return yield* Effect.fail(controlError("forbidden", targetError));
          }
          if (
            activeDelegatedTurnCount(snapshot, scope.principal.assistantThreadId) >=
            MAX_CONCURRENT_ASSISTANT_DELEGATIONS
          ) {
            return yield* Effect.fail(
              controlError("conflict", "Quick Chat already has three delegated turns running."),
            );
          }
          return {
            type: "thread.turn.start" as const,
            commandId,
            threadId: args.threadId,
            message: {
              messageId: MessageId.make(`delegated-message:${invocation.actionId}`),
              role: "user" as const,
              text: args.text,
              attachments: [],
            },
            runtimeMode: target?.runtimeMode ?? "full-access",
            interactionMode: target?.interactionMode ?? "default",
            delegation: {
              assistantThreadId: scope.principal.assistantThreadId,
              actionId: invocation.actionId,
              depth: 1 as const,
            },
            createdAt,
          };
        }
        case "delegation.turn.stop": {
          const args = yield* decode(ThreadIdArgs);
          if (scope.principal.kind !== "global-assistant") {
            return yield* Effect.fail(controlError("forbidden", "Delegation requires Quick Chat."));
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Thread state is unavailable."));
          }
          const target = yield* projections.value
            .getThreadDetailById(args.threadId)
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Thread state is unavailable.")),
            );
          const targetError = validateDelegationTarget({
            principal: scope.principal,
            target: Option.getOrUndefined(target),
            requireActive: true,
          });
          if (targetError !== undefined) {
            return yield* Effect.fail(controlError("forbidden", targetError));
          }
          const latestDelegated = Option.getOrUndefined(target)?.messages.findLast(
            (message) => message.role === "user" && message.delegation !== undefined,
          );
          if (
            latestDelegated?.delegation?.assistantThreadId !== scope.principal.assistantThreadId
          ) {
            return yield* Effect.fail(
              controlError("forbidden", "Quick Chat may stop only turns it delegated."),
            );
          }
          return {
            type: "thread.session.stop" as const,
            commandId,
            threadId: args.threadId,
            createdAt,
          };
        }
        case "project.create": {
          const args = yield* decode(ProjectCreateArgs);
          return {
            type: "project.create" as const,
            commandId,
            projectId: args.projectId,
            title: args.title,
            workspaceRoot: args.workspaceRoot,
            createWorkspaceRootIfMissing: false,
            createdAt,
          };
        }
        case "project.rename": {
          const args = yield* decode(ProjectRenameArgs);
          return {
            type: "project.meta.update" as const,
            commandId,
            projectId: args.projectId,
            title: args.title,
          };
        }
        case "script.import": {
          if (scope.principal.kind !== "thread-agent") {
            return yield* Effect.fail(
              controlError("forbidden", "Project terminal actions require a project thread agent."),
            );
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Project state is unavailable."));
          }
          const args = yield* decode(ProjectScriptImportArgs);
          if (args.projectId !== scope.principal.projectId) {
            return yield* Effect.fail(
              controlError("forbidden", "Thread agents cannot save actions in another project."),
            );
          }
          const project = yield* projections.value
            .getProjectShellById(args.projectId)
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Project state is unavailable.")),
            );
          if (Option.isNone(project) || project.value.kind !== "workspace") {
            return yield* Effect.fail(
              controlError("invalid-input", "The current workspace project does not exist."),
            );
          }
          const imported: ProjectScript = {
            id: args.script.id,
            name: args.script.name,
            command: args.script.command,
            icon: args.script.icon ?? "play",
            runOnWorktreeCreate: args.script.runOnWorktreeCreate ?? false,
            showInToolbar: false,
            ...(args.script.previewUrl === undefined
              ? {}
              : {
                  previewUrl: args.script.previewUrl,
                  autoOpenPreview: args.script.autoOpenPreview ?? false,
                }),
          };
          const existing = project.value.scripts.find((script) => script.id === imported.id);
          if (existing !== undefined && !projectScriptsEqual(existing, imported)) {
            return yield* Effect.fail(
              controlError(
                "conflict",
                `Project action ${imported.id} already exists with a different definition.`,
              ),
            );
          }
          const scripts =
            existing !== undefined
              ? project.value.scripts
              : imported.runOnWorktreeCreate
                ? [
                    ...project.value.scripts.map((script) =>
                      script.runOnWorktreeCreate
                        ? { ...script, runOnWorktreeCreate: false }
                        : script,
                    ),
                    imported,
                  ]
                : [...project.value.scripts, imported];
          return {
            type: "project.meta.update" as const,
            commandId,
            projectId: args.projectId,
            scripts,
          };
        }
        case "project.action.upsert": {
          if (scope.principal.kind !== "thread-agent") {
            return yield* Effect.fail(
              controlError("forbidden", "Project actions require a project thread agent."),
            );
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Project state is unavailable."));
          }
          const rawArgs = Predicate.isObject(invocation.args) ? invocation.args : {};
          const rawAction = Predicate.isObject(rawArgs.action) ? rawArgs.action : {};
          if ("placement" in rawAction) {
            return yield* Effect.fail(
              controlError("invalid-input", "Only the user can pin actions to the top bar."),
            );
          }
          const args = yield* decode(ProjectActionUpsertArgs);
          if (args.projectId !== scope.principal.projectId) {
            return yield* Effect.fail(
              controlError("forbidden", "Thread agents cannot change another project's actions."),
            );
          }
          const project = yield* projections.value
            .getProjectShellById(args.projectId)
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Project state is unavailable.")),
            );
          if (Option.isNone(project) || project.value.kind !== "workspace") {
            return yield* Effect.fail(
              controlError("invalid-input", "The current workspace project does not exist."),
            );
          }
          const current = project.value.customActions ?? [];
          const existing = current.find((candidate) => candidate.id === args.action.id);
          const defaultIcon =
            args.action.commandId === "ui.external-url.open" ? "external-link" : "terminal";
          const base = {
            id: args.action.id,
            name: args.action.name,
            icon: args.action.icon ?? existing?.icon ?? defaultIcon,
            // Placement is user-owned. Agents create menu actions and updates
            // preserve an existing user pin.
            placement: existing?.placement ?? "menu",
          } as const;
          let action: ProjectCustomAction;
          if (args.action.commandId === "ui.external-url.open") {
            if (args.action.url === undefined) {
              return yield* Effect.fail(controlError("invalid-input", "URL actions require url."));
            }
            action = {
              ...base,
              commandId: "ui.external-url.open",
              args: { url: args.action.url },
            };
          } else {
            if (args.action.scriptId === undefined) {
              return yield* Effect.fail(
                controlError("invalid-input", "Script actions require scriptId."),
              );
            }
            if (!project.value.scripts.some((script) => script.id === args.action.scriptId)) {
              return yield* Effect.fail(
                controlError("invalid-input", "Project terminal action is not saved."),
              );
            }
            action = {
              ...base,
              commandId: "script.run",
              args: { scriptId: args.action.scriptId },
            };
          }
          const customActions = current.some((candidate) => candidate.id === action.id)
            ? current.map((candidate) => (candidate.id === action.id ? action : candidate))
            : [...current, action];
          return {
            type: "project.meta.update" as const,
            commandId,
            projectId: args.projectId,
            customActions,
          };
        }
        case "project.action.delete": {
          if (scope.principal.kind !== "thread-agent") {
            return yield* Effect.fail(
              controlError("forbidden", "Project actions require a project thread agent."),
            );
          }
          if (Option.isNone(projections)) {
            return yield* Effect.fail(controlError("unavailable", "Project state is unavailable."));
          }
          const args = yield* decode(ProjectActionDeleteArgs);
          if (args.projectId !== scope.principal.projectId) {
            return yield* Effect.fail(
              controlError("forbidden", "Thread agents cannot change another project's actions."),
            );
          }
          const project = yield* projections.value
            .getProjectShellById(args.projectId)
            .pipe(
              Effect.mapError(() => controlError("unavailable", "Project state is unavailable.")),
            );
          if (Option.isNone(project) || project.value.kind !== "workspace") {
            return yield* Effect.fail(
              controlError("invalid-input", "The current workspace project does not exist."),
            );
          }
          const current = project.value.customActions ?? [];
          if (!current.some((action) => action.id === args.actionId)) {
            return yield* Effect.fail(controlError("invalid-input", "Project action not found."));
          }
          return {
            type: "project.meta.update" as const,
            commandId,
            projectId: args.projectId,
            customActions: current.filter((action) => action.id !== args.actionId),
          };
        }
        case "project.delete": {
          const args = yield* decode(ProjectDeleteArgs);
          return {
            type: "project.delete" as const,
            commandId,
            projectId: args.projectId,
            ...(args.force === undefined ? {} : { force: args.force }),
          };
        }
        case "thread.rename": {
          const args = yield* decode(ThreadRenameArgs);
          return {
            type: "thread.meta.update" as const,
            commandId,
            threadId: args.threadId,
            title: args.title,
          };
        }
        case "thread.archive": {
          const args = yield* decode(ThreadIdArgs);
          return { type: "thread.archive" as const, commandId, threadId: args.threadId };
        }
        case "thread.unarchive": {
          const args = yield* decode(ThreadIdArgs);
          return { type: "thread.unarchive" as const, commandId, threadId: args.threadId };
        }
        case "thread.settle": {
          const args = yield* decode(ThreadIdArgs);
          return { type: "thread.settle" as const, commandId, threadId: args.threadId };
        }
        case "thread.delete": {
          const args = yield* decode(ThreadIdArgs);
          return { type: "thread.delete" as const, commandId, threadId: args.threadId };
        }
        case "thread.unsettle": {
          const args = yield* decode(ThreadIdArgs);
          return {
            type: "thread.unsettle" as const,
            commandId,
            threadId: args.threadId,
            reason: "user" as const,
          };
        }
        case "thread.snooze": {
          const args = yield* decode(ThreadSnoozeArgs);
          return {
            type: "thread.snooze" as const,
            commandId,
            threadId: args.threadId,
            snoozedUntil: args.until,
          };
        }
        case "thread.unsnooze": {
          const args = yield* decode(ThreadIdArgs);
          return {
            type: "thread.unsnooze" as const,
            commandId,
            threadId: args.threadId,
            reason: "user" as const,
          };
        }
        case "thread.model.change": {
          const args = yield* decode(ThreadModelArgs);
          return {
            type: "thread.meta.update" as const,
            commandId,
            threadId: args.threadId,
            modelSelection: args.modelSelection,
          };
        }
        case "thread.mode.change": {
          const args = yield* decode(ThreadModeArgs);
          return {
            type: "thread.interaction-mode.set" as const,
            commandId,
            threadId: args.threadId,
            interactionMode: args.mode,
            createdAt,
          };
        }
        case "thread.interrupt": {
          const args = yield* decode(ThreadIdArgs);
          return {
            type: "thread.turn.interrupt" as const,
            commandId,
            threadId: args.threadId,
            createdAt,
          };
        }
        case "thread.stop": {
          const args = yield* decode(ThreadIdArgs);
          return {
            type: "thread.session.stop" as const,
            commandId,
            threadId: args.threadId,
            createdAt,
          };
        }
        case "thread.checkpoint.revert": {
          const args = yield* decode(ThreadRevertArgs);
          return {
            type: "thread.checkpoint.revert" as const,
            commandId,
            threadId: args.threadId,
            turnCount: args.turnCount,
            createdAt,
          };
        }
        default:
          return yield* Effect.fail(
            controlError(
              "unsupported",
              `Server execution is not implemented for ${invocation.commandId}.`,
            ),
          );
      }
    }).pipe(Effect.result);
    if (command._tag === "Failure") return failed(invocation, command.failure);

    const dispatched = yield* engine.dispatch(command.success).pipe(Effect.result);
    if (dispatched._tag === "Failure") {
      return failed(
        invocation,
        controlError("execution-failed", "The orchestration command could not be applied."),
      );
    }
    const receipt: AppActionReceipt = {
      receiptId: `app-control-receipt:${scope.providerSessionId}:${invocation.actionId}`,
      actionId: invocation.actionId,
      commandId: invocation.commandId,
      sequence: dispatched.success.sequence,
      revision: dispatched.success.sequence,
      completedAt: createdAt,
      idempotentReplay: false,
    };
    return { status: "completed", receipt, result: { sequence: dispatched.success.sequence } };
  });

  return AppControlServerExecutor.of({ execute });
});

export const layer = Layer.effect(AppControlServerExecutor, make);
