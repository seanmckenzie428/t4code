import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const AppCommandId = TrimmedNonEmptyString.pipe(Schema.brand("AppCommandId"));
export type AppCommandId = typeof AppCommandId.Type;
export const AppActionId = TrimmedNonEmptyString.pipe(Schema.brand("AppActionId"));
export type AppActionId = typeof AppActionId.Type;

export const AppControlPrincipal = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("thread-agent"),
    threadId: ThreadId,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("global-assistant"),
    assistantThreadId: ThreadId,
  }),
]);
export type AppControlPrincipal = typeof AppControlPrincipal.Type;

export const AppControlRisk = Schema.Literals([
  "observe",
  "navigate",
  "mutate",
  "external",
  "destructive",
  "forbidden",
]);
export type AppControlRisk = typeof AppControlRisk.Type;

/** JSON Schema document supplied to providers for command discovery. */
export const AppControlJsonSchema = Schema.Record(Schema.String, Schema.Unknown);
export type AppControlJsonSchema = typeof AppControlJsonSchema.Type;

export const AppCommandDescriptor = Schema.Struct({
  id: AppCommandId,
  version: Schema.Literal(1),
  owner: Schema.Literals(["server", "client"]),
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  domain: Schema.optional(TrimmedNonEmptyString),
  risk: AppControlRisk,
  requiredGrant: Schema.NullOr(TrimmedNonEmptyString),
  inputSchema: AppControlJsonSchema,
  outputSchema: AppControlJsonSchema,
});
export type AppCommandDescriptor = typeof AppCommandDescriptor.Type;

export const AppCommandInvocation = Schema.Struct({
  actionId: AppActionId,
  commandId: AppCommandId,
  args: Schema.Unknown,
  expectedRevision: Schema.optional(NonNegativeInt),
});
export type AppCommandInvocation = typeof AppCommandInvocation.Type;

/**
 * Authenticated client request for a server-owned semantic command. The
 * principal is the currently rendered thread/assistant scope; the server still
 * revalidates it against the command arguments and projections before running.
 */
export const AppControlServerInvocation = Schema.Struct({
  principal: AppControlPrincipal,
  invocation: AppCommandInvocation,
});
export type AppControlServerInvocation = typeof AppControlServerInvocation.Type;

export const AppActionReceipt = Schema.Struct({
  receiptId: TrimmedNonEmptyString,
  actionId: AppActionId,
  commandId: AppCommandId,
  sequence: Schema.optional(NonNegativeInt),
  revision: Schema.optional(NonNegativeInt),
  completedAt: IsoDateTime,
  idempotentReplay: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type AppActionReceipt = typeof AppActionReceipt.Type;

export const AppControlErrorCode = Schema.Literals([
  "unavailable",
  "disconnected",
  "timeout",
  "malformed-response",
  "unsupported",
  "forbidden",
  "conflict",
  "invalid-input",
  "execution-failed",
]);
export type AppControlErrorCode = typeof AppControlErrorCode.Type;

export const AppControlError = Schema.Struct({
  code: AppControlErrorCode,
  message: TrimmedNonEmptyString,
  retryable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  detail: Schema.optional(Schema.Unknown),
});
export type AppControlError = typeof AppControlError.Type;

export const AppCommandResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    receipt: AppActionReceipt,
    result: Schema.Unknown,
  }),
  Schema.Struct({
    status: Schema.Literal("declined"),
    actionId: AppActionId,
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    actionId: AppActionId,
    error: AppControlError,
  }),
]);
export type AppCommandResult = typeof AppCommandResult.Type;

export const ClientUiSnapshot = Schema.Struct({
  clientId: TrimmedNonEmptyString,
  surface: Schema.Literals(["web", "desktop"]),
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  quickChatOpen: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Legacy client field accepted during rolling upgrades. */
  assistantOpen: Schema.optionalKey(Schema.Boolean),
  activePanel: Schema.NullOr(TrimmedNonEmptyString),
  revision: NonNegativeInt,
});
export type ClientUiSnapshot = typeof ClientUiSnapshot.Type;

export const AppControlProjectSummary = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  kind: Schema.Literals(["workspace", "system"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("workspace" as const)),
  ),
});
export type AppControlProjectSummary = typeof AppControlProjectSummary.Type;

export const AppControlThreadSummary = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  kind: Schema.Literals(["project", "assistant"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("project" as const)),
  ),
});
export type AppControlThreadSummary = typeof AppControlThreadSummary.Type;

export const AppControlViewSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  kind: Schema.Literals(["native", "sandboxed"]),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
    Schema.Struct({ kind: Schema.Literal("personal") }),
    Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  ]),
});
export type AppControlViewSummary = typeof AppControlViewSummary.Type;

export const AppControlSnapshot = Schema.Struct({
  sequence: NonNegativeInt,
  environmentId: EnvironmentId,
  focusedClient: Schema.NullOr(ClientUiSnapshot),
  projects: Schema.Array(AppControlProjectSummary),
  threads: Schema.Array(AppControlThreadSummary),
  views: Schema.Array(AppControlViewSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  commands: Schema.Array(AppCommandDescriptor),
});
export type AppControlSnapshot = typeof AppControlSnapshot.Type;

export const AppControlClientId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type AppControlClientId = typeof AppControlClientId.Type;
export const AppControlConnectionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type AppControlConnectionId = typeof AppControlConnectionId.Type;

export const AppControlHostIdentity = Schema.Struct({
  clientId: AppControlClientId,
  environmentId: EnvironmentId,
});
export type AppControlHostIdentity = typeof AppControlHostIdentity.Type;

export const AppControlHost = Schema.Struct({
  ...AppControlHostIdentity.fields,
  supportedCommandIds: Schema.optional(Schema.Array(AppCommandId)),
});
export type AppControlHost = typeof AppControlHost.Type;

export const AppControlHostFocus = Schema.Struct({
  ...AppControlHostIdentity.fields,
  connectionId: AppControlConnectionId,
  focused: Schema.Boolean,
});
export type AppControlHostFocus = typeof AppControlHostFocus.Type;

export const AppControlRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  actionId: AppActionId,
  principal: AppControlPrincipal,
  commandId: AppCommandId,
  args: Schema.Unknown,
  expectedRevision: Schema.optional(NonNegativeInt),
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
  confirmation: Schema.optional(
    Schema.Struct({
      title: TrimmedNonEmptyString,
      description: TrimmedNonEmptyString,
      risk: Schema.Literals(["external", "destructive"]),
      targetName: TrimmedNonEmptyString,
      environmentId: EnvironmentId,
      descendants: Schema.optional(NonNegativeInt),
      recoverability: TrimmedNonEmptyString,
      rememberAllowed: Schema.Literal(false),
    }),
  ),
});
export type AppControlRequest = typeof AppControlRequest.Type;

export const AppControlStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("connected"),
    connectionId: AppControlConnectionId,
  }),
  Schema.Struct({
    type: Schema.Literal("request"),
    connectionId: AppControlConnectionId,
    request: AppControlRequest,
  }),
]);
export type AppControlStreamEvent = typeof AppControlStreamEvent.Type;

export const AppControlResponse = Schema.Struct({
  clientId: AppControlClientId,
  connectionId: AppControlConnectionId,
  requestId: TrimmedNonEmptyString,
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(AppControlError),
  decision: Schema.optional(Schema.Literals(["allow", "decline"])),
});
export type AppControlResponse = typeof AppControlResponse.Type;

const AppControlFailureFields = {
  environmentId: EnvironmentId,
  principal: Schema.optional(AppControlPrincipal),
  commandId: Schema.optional(AppCommandId),
  actionId: Schema.optional(AppActionId),
} as const;

export class AppControlUnavailableError extends Schema.TaggedErrorClass<AppControlUnavailableError>()(
  "AppControlUnavailableError",
  {
    ...AppControlFailureFields,
    capability: Schema.Literal("app-control"),
    reason: Schema.optional(TrimmedNonEmptyString),
  },
) {
  override get message(): string {
    return this.reason ?? "App control is unavailable for this provider session.";
  }
}

export class AppControlDisconnectedError extends Schema.TaggedErrorClass<AppControlDisconnectedError>()(
  "AppControlDisconnectedError",
  {
    ...AppControlFailureFields,
    clientId: AppControlClientId,
    connectionId: AppControlConnectionId,
    requestId: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `App control client ${this.clientId} disconnected before completing the request.`;
  }
}

export class AppControlTimeoutError extends Schema.TaggedErrorClass<AppControlTimeoutError>()(
  "AppControlTimeoutError",
  {
    ...AppControlFailureFields,
    requestId: TrimmedNonEmptyString,
    timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
  },
) {
  override get message(): string {
    return `App control request timed out after ${this.timeoutMs}ms.`;
  }
}

export class AppControlMalformedResponseError extends Schema.TaggedErrorClass<AppControlMalformedResponseError>()(
  "AppControlMalformedResponseError",
  {
    ...AppControlFailureFields,
    clientId: AppControlClientId,
    connectionId: AppControlConnectionId,
    requestId: TrimmedNonEmptyString,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `App control client ${this.clientId} returned a malformed response.`;
  }
}
