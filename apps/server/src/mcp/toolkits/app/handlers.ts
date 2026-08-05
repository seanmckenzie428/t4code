import {
  AppActionId,
  AppCommandId,
  type AppCommandDescriptor,
  type AppCommandResult,
  type AppControlRisk,
  type AppControlSnapshot,
  type AppControlPrincipal,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AppControlBroker from "../../AppControlBroker.ts";
import * as AppControlPolicy from "../../AppControlPolicy.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AppControlToolkit } from "./tools.ts";

export const APP_STATUS_COMMAND_ID = AppCommandId.make("app.status");
export const APP_COMMANDS_COMMAND_ID = AppCommandId.make("app.commands");
export const APP_VIEW_PRESENT_COMMAND_ID = AppCommandId.make("view.present");
export const APP_VIEW_UPDATE_COMMAND_ID = AppCommandId.make("view.update");
export const APP_VIEW_REMOVE_COMMAND_ID = AppCommandId.make("view.close");

const FORBIDDEN_COMMAND_IDS = new Set([
  "approval.respond",
  "approval.resolve",
  "user-input.respond",
  "user-input.resolve",
  "capability-grant.mutate",
]);

const REQUIRES_EXPLICIT_CONFIRMATION_COMMAND_IDS = new Set([
  "project.clone",
  "project.delete",
  "thread.delete",
  "thread.checkpoint.revert",
  "terminal.command.run",
  "source-control.publish",
  "source-control.change-request.create",
  "ui.external-url.open",
  "view.delete",
]);

export const requiresExplicitAppControlConfirmation = (commandId: string): boolean =>
  REQUIRES_EXPLICIT_CONFIRMATION_COMMAND_IDS.has(commandId);

export const isAgentDiscoverableCommand = (descriptor: AppCommandDescriptor): boolean =>
  descriptor.risk !== "forbidden" && !FORBIDDEN_COMMAND_IDS.has(descriptor.id);

export const isAgentInvocableCommandId = (commandId: string): boolean =>
  !FORBIDDEN_COMMAND_IDS.has(commandId);

export function scopeAppControlSnapshot(
  snapshot: AppControlSnapshot,
  principal: AppControlPrincipal,
): AppControlSnapshot {
  if (principal.kind === "global-assistant") {
    return snapshot;
  }
  const focusedClient = snapshot.focusedClient;
  return {
    ...snapshot,
    focusedClient:
      focusedClient?.projectId === principal.projectId ||
      focusedClient?.threadId === principal.threadId
        ? focusedClient
        : null,
    projects: snapshot.projects.filter((project) => project.id === principal.projectId),
    threads: snapshot.threads.filter((thread) => thread.id === principal.threadId),
    views: snapshot.views.filter(
      (view) =>
        (view.scope.kind === "thread" && view.scope.threadId === principal.threadId) ||
        (view.scope.kind === "project" && view.scope.projectId === principal.projectId),
    ),
    commands: snapshot.commands.filter(isAgentDiscoverableCommand),
  };
}

const requireScope = () =>
  McpInvocationContext.requireAppControlScope().pipe(
    Effect.mapError((error) => ({
      code: "unavailable" as const,
      message: error.message,
      retryable: false,
    })),
  );

const invoke = Effect.fn("AppControlToolkit.invoke")(function* <A>(invocation: {
  readonly actionId: AppActionId;
  readonly commandId: AppCommandId;
  readonly args: unknown;
  readonly expectedRevision?: number | undefined;
}): Effect.fn.Return<
  A,
  import("@t3tools/contracts").AppControlError,
  McpInvocationContext.McpInvocationContext | AppControlPolicy.AppControlPolicy
> {
  const scope = yield* requireScope();
  const policy = yield* AppControlPolicy.AppControlPolicy;
  return (yield* policy.invoke({ scope, invocation })) as A;
});

const readonlyActionId = (scope: { readonly providerSessionId: string }, suffix: string) =>
  AppActionId.make(`${scope.providerSessionId}:${suffix}`);

const handlers = {
  app_status: () =>
    Effect.gen(function* () {
      const scope = yield* requireScope();
      yield* AppControlPolicy.AppControlPolicy;
      const broker = yield* AppControlBroker.AppControlBroker;
      const snapshot = yield* broker.invoke<AppControlSnapshot>({
        scope,
        invocation: {
          actionId: readonlyActionId(scope, "status"),
          commandId: APP_STATUS_COMMAND_ID,
          args: {},
        },
      });
      return scopeAppControlSnapshot(snapshot, scope.principal);
    }),
  app_commands: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireScope();
      yield* AppControlPolicy.AppControlPolicy;
      const broker = yield* AppControlBroker.AppControlBroker;
      const commands = yield* broker.invoke<ReadonlyArray<AppCommandDescriptor>>({
        scope,
        invocation: {
          actionId: readonlyActionId(scope, "commands"),
          commandId: APP_COMMANDS_COMMAND_ID,
          args: input,
        },
      });
      const risks = input.risks === undefined ? undefined : new Set<AppControlRisk>(input.risks);
      return commands.filter(
        (command) =>
          isAgentDiscoverableCommand(command) &&
          (input.domain === undefined || command.domain === input.domain) &&
          (risks === undefined || risks.has(command.risk)),
      );
    }),
  app_invoke: (input) => invoke<AppCommandResult>(input),
  app_view_present: (input) =>
    invoke<AppCommandResult>({
      actionId: input.actionId,
      commandId: APP_VIEW_PRESENT_COMMAND_ID,
      args: { manifest: input.manifest, createNew: input.createNew ?? false },
    }),
  app_view_update: (input) =>
    invoke<AppCommandResult>({
      actionId: input.actionId,
      commandId: APP_VIEW_UPDATE_COMMAND_ID,
      args: {
        viewId: input.viewId,
        manifest: input.manifest,
        expectedRevision: input.expectedRevision,
      },
      expectedRevision: input.expectedRevision,
    }),
  app_view_remove: (input) =>
    invoke<AppCommandResult>({
      actionId: input.actionId,
      commandId: APP_VIEW_REMOVE_COMMAND_ID,
      args: { viewId: input.viewId },
    }),
} satisfies Parameters<typeof AppControlToolkit.toLayer>[0];

export const AppControlToolkitHandlersLive = AppControlToolkit.toLayer(handlers);
