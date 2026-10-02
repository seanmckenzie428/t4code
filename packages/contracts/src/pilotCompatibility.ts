import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

export const PROJECT_CUSTOM_ACTION_ICON_IDS = [
  "play",
  "link",
  "external-link",
  "terminal",
  "database",
  "server",
  "globe",
  "dashboard",
  "mail",
  "settings",
  "git-branch",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
] as const;
export const ProjectCustomActionIcon = Schema.Literals(PROJECT_CUSTOM_ACTION_ICON_IDS);
export type ProjectCustomActionIcon = typeof ProjectCustomActionIcon.Type;

const ProjectCustomActionBase = {
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  // Older projected actions did not persist an icon. Decode those as play so
  // clients can render one stable, validated icon without migration coupling.
  icon: ProjectCustomActionIcon.pipe(Schema.withDecodingDefault(Effect.succeed("play" as const))),
  placement: Schema.Literals(["menu", "toolbar"]),
} as const;
export const ProjectCustomAction = Schema.Union([
  Schema.Struct({
    ...ProjectCustomActionBase,
    commandId: Schema.Literal("ui.external-url.open"),
    args: Schema.Struct({ url: TrimmedNonEmptyString }),
  }),
  Schema.Struct({
    ...ProjectCustomActionBase,
    commandId: Schema.Literal("script.run"),
    args: Schema.Struct({ scriptId: TrimmedNonEmptyString }),
  }),
]);
export type ProjectCustomAction = typeof ProjectCustomAction.Type;

export const OrchestrationProjectKind = Schema.Literals(["workspace", "system"]);
export type OrchestrationProjectKind = typeof OrchestrationProjectKind.Type;
export const OrchestrationProjectSystemRole = Schema.Literals(["global-assistant", "quick-chat"]);
export type OrchestrationProjectSystemRole = typeof OrchestrationProjectSystemRole.Type;
export const OrchestrationThreadKind = Schema.Literals(["project", "assistant", "quick"]);
export type OrchestrationThreadKind = typeof OrchestrationThreadKind.Type;

export const OrchestrationWorkspaceBinding = Schema.Struct({
  extensionId: TrimmedNonEmptyString,
  providerId: TrimmedNonEmptyString,
  workspaceId: TrimmedNonEmptyString,
});
export type OrchestrationWorkspaceBinding = typeof OrchestrationWorkspaceBinding.Type;

export const DelegationOrigin = Schema.Struct({
  assistantThreadId: ThreadId,
  actionId: TrimmedNonEmptyString,
  depth: Schema.Literal(1),
});
export type DelegationOrigin = typeof DelegationOrigin.Type;

export const ThreadArchiveLifecycle = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  direction: Schema.Literals(["archive", "restore"]),
  status: Schema.Literals(["pending", "retrying"]),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadArchiveLifecycle = typeof ThreadArchiveLifecycle.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;
