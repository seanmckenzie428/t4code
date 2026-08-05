import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ExtensionId = TrimmedNonEmptyString.pipe(Schema.brand("ExtensionId"));
export type ExtensionId = typeof ExtensionId.Type;

export const ExtensionCapability = Schema.Literals([
  "tools",
  "resources",
  "mcp-apps",
  "external-origins",
  "workspace-provider",
]);
export type ExtensionCapability = typeof ExtensionCapability.Type;

export const StdioExtensionTransport = Schema.Struct({
  kind: Schema.Literal("stdio"),
  executable: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type StdioExtensionTransport = typeof StdioExtensionTransport.Type;

export const StreamableHttpExtensionTransport = Schema.Struct({
  kind: Schema.Literal("streamable-http"),
  url: TrimmedNonEmptyString,
});
export type StreamableHttpExtensionTransport = typeof StreamableHttpExtensionTransport.Type;

export const ExtensionTransport = Schema.Union([
  StdioExtensionTransport,
  StreamableHttpExtensionTransport,
]);
export type ExtensionTransport = typeof ExtensionTransport.Type;

export const ExtensionApproval = Schema.Struct({
  identityHash: TrimmedNonEmptyString,
  capabilities: Schema.Array(ExtensionCapability),
  approvedAt: IsoDateTime,
});
export type ExtensionApproval = typeof ExtensionApproval.Type;

export const InstalledExtension = Schema.Struct({
  id: ExtensionId,
  title: TrimmedNonEmptyString,
  transport: ExtensionTransport,
  requestedCapabilities: Schema.Array(ExtensionCapability).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  config: Schema.optionalKey(Schema.Unknown),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  approval: Schema.NullOr(ExtensionApproval).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type InstalledExtension = typeof InstalledExtension.Type;

/** Safe repository request. It cannot declare a process or enable an extension. */
export const T3ProjectExtensionRequest = Schema.Struct({
  id: ExtensionId,
  config: Schema.optionalKey(Schema.Unknown),
});
export type T3ProjectExtensionRequest = typeof T3ProjectExtensionRequest.Type;

export const ExtensionEnablementPreview = Schema.Struct({
  id: ExtensionId,
  title: TrimmedNonEmptyString,
  transport: ExtensionTransport,
  requestedCapabilities: Schema.Array(ExtensionCapability),
  identityHash: TrimmedNonEmptyString,
});
export type ExtensionEnablementPreview = typeof ExtensionEnablementPreview.Type;

export const ExtensionRuntimeStatus = Schema.Literals([
  "disabled",
  "approval-required",
  "ready",
  "unavailable",
]);
export type ExtensionRuntimeStatus = typeof ExtensionRuntimeStatus.Type;

export const ExtensionRuntimeState = Schema.Struct({
  extension: InstalledExtension,
  identityHash: TrimmedNonEmptyString,
  status: ExtensionRuntimeStatus,
  message: Schema.optionalKey(Schema.String),
});
export type ExtensionRuntimeState = typeof ExtensionRuntimeState.Type;

export const WorkspaceProviderMetadataKey = "t3.workspace-provider/v1" as const;

export const WorkspaceDetection = Schema.Struct({
  detected: Schema.Boolean,
  confidence: Schema.Number,
  workspaceId: Schema.optionalKey(TrimmedNonEmptyString),
  reason: Schema.optionalKey(Schema.String),
});
export type WorkspaceDetection = typeof WorkspaceDetection.Type;

export const WorkspaceDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  root: Schema.optionalKey(TrimmedNonEmptyString),
  status: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Unknown),
});
export type WorkspaceDescriptor = typeof WorkspaceDescriptor.Type;

export const WorkspaceDetail = Schema.Struct({
  workspace: WorkspaceDescriptor,
  actions: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  detail: Schema.optionalKey(Schema.Unknown),
});
export type WorkspaceDetail = typeof WorkspaceDetail.Type;

export const WorkspaceAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  risk: Schema.Literals(["observe", "mutate", "external", "destructive"]),
  inputSchema: Schema.Unknown,
});
export type WorkspaceAction = typeof WorkspaceAction.Type;

export const AsyncWorkspaceOperation = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "running", "completed", "failed"]),
  workspaceId: Schema.optionalKey(TrimmedNonEmptyString),
  message: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Unknown),
});
export type AsyncWorkspaceOperation = typeof AsyncWorkspaceOperation.Type;

export const ObservedWorkspaceProjection = Schema.Struct({
  extensionId: ExtensionId,
  providerId: TrimmedNonEmptyString,
  workspace: WorkspaceDescriptor,
  observedAt: IsoDateTime,
  stale: Schema.Boolean,
});
export type ObservedWorkspaceProjection = typeof ObservedWorkspaceProjection.Type;

export interface WorkspaceProvider {
  readonly detect: (projectRoot: string) => Promise<WorkspaceDetection>;
  readonly list: () => Promise<ReadonlyArray<WorkspaceDescriptor>>;
  readonly describe: (workspaceId: string) => Promise<WorkspaceDetail>;
  readonly create: (input: unknown) => Promise<AsyncWorkspaceOperation>;
  readonly listActions: (workspaceId: string) => Promise<ReadonlyArray<WorkspaceAction>>;
  readonly invoke: (
    workspaceId: string,
    actionId: string,
    args: unknown,
  ) => Promise<AsyncWorkspaceOperation>;
}
