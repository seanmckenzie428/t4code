import * as Schema from "effect/Schema";

import { MessageId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION = 1 as const;
export const DESKTOP_APP_ACTIVATION_MAX_BYTES = 64 * 1024;

export const DesktopAppActivationPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type DesktopAppActivationPlatform = typeof DesktopAppActivationPlatform.Type;

export const DesktopAppOpenWorkspaceRequest = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  type: Schema.Literal("open-workspace"),
  workspaceRoot: TrimmedNonEmptyString,
  platform: DesktopAppActivationPlatform,
});
export const DesktopAppStartThreadRequest = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  type: Schema.Literal("start-thread"),
  workspaceRoot: TrimmedNonEmptyString,
  platform: DesktopAppActivationPlatform,
  worktreePath: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  prompt: Schema.optional(TrimmedNonEmptyString),
});
export type DesktopAppStartThreadRequest = typeof DesktopAppStartThreadRequest.Type;

export const DesktopAppActivationRequest = Schema.Union([
  DesktopAppOpenWorkspaceRequest,
  DesktopAppStartThreadRequest,
]);
export type DesktopAppActivationRequest = typeof DesktopAppActivationRequest.Type;

export const DesktopAppActivationErrorCode = Schema.Literals([
  "invalid-request",
  "renderer-unavailable",
  "environment-unavailable",
  "platform-mismatch",
  "project-create-failed",
  "thread-open-failed",
  "thread-start-failed",
  "project-not-found",
  "request-timeout",
  "internal-error",
]);
export type DesktopAppActivationErrorCode = typeof DesktopAppActivationErrorCode.Type;

export const DesktopAppActivationSuccess = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(true),
  projectId: ProjectId,
  threadId: ThreadId,
  messageId: Schema.optional(MessageId),
  accepted: Schema.optional(Schema.Boolean),
});
export type DesktopAppActivationSuccess = typeof DesktopAppActivationSuccess.Type;

export const DesktopAppActivationFailure = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(false),
  code: DesktopAppActivationErrorCode,
  message: TrimmedNonEmptyString,
});
export type DesktopAppActivationFailure = typeof DesktopAppActivationFailure.Type;

export const DesktopAppActivationResponse = Schema.Union([
  DesktopAppActivationSuccess,
  DesktopAppActivationFailure,
]);
export type DesktopAppActivationResponse = typeof DesktopAppActivationResponse.Type;
