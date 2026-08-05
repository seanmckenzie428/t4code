import {
  type AsyncWorkspaceOperation,
  type ExtensionCapability,
  type ExtensionEnablementPreview,
  type ExtensionId,
  type ExtensionRuntimeState,
  type InstalledExtension,
  type ObservedWorkspaceProjection,
  type WorkspaceAction,
  type WorkspaceDescriptor,
  type WorkspaceDetail,
  type WorkspaceDetection,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ServerSettingsService } from "../serverSettings.ts";

export class ExtensionHostError extends Schema.TaggedErrorClass<ExtensionHostError>()(
  "ExtensionHostError",
  {
    operation: Schema.Literals([
      "inspect",
      "approve",
      "connect",
      "list-tools",
      "invoke-tool",
      "read-resource",
      "workspace-detect",
      "workspace-list",
      "workspace-describe",
      "workspace-create",
      "workspace-list-actions",
      "workspace-invoke",
    ]),
    extensionId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ExtensionToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExtensionResourceDescriptor {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly [key: string]: unknown;
}

export interface WorkspaceProviderConnection {
  readonly providerId: string;
  readonly detect: (projectRoot: string) => Effect.Effect<WorkspaceDetection, ExtensionHostError>;
  readonly list: Effect.Effect<ReadonlyArray<WorkspaceDescriptor>, ExtensionHostError>;
  readonly describe: (workspaceId: string) => Effect.Effect<WorkspaceDetail, ExtensionHostError>;
  readonly create: (input: unknown) => Effect.Effect<AsyncWorkspaceOperation, ExtensionHostError>;
  readonly listActions: (
    workspaceId: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceAction>, ExtensionHostError>;
  readonly invoke: (
    workspaceId: string,
    actionId: string,
    args: unknown,
  ) => Effect.Effect<AsyncWorkspaceOperation, ExtensionHostError>;
}

export interface ExtensionConnection {
  readonly listTools: Effect.Effect<ReadonlyArray<ExtensionToolDescriptor>, ExtensionHostError>;
  readonly listResources?: Effect.Effect<
    ReadonlyArray<ExtensionResourceDescriptor>,
    ExtensionHostError
  >;
  readonly invokeTool: (name: string, input: unknown) => Effect.Effect<unknown, ExtensionHostError>;
  readonly readResource: (uri: string) => Effect.Effect<unknown, ExtensionHostError>;
  readonly workspaceProvider?: WorkspaceProviderConnection;
  readonly disconnect?: Effect.Effect<void, never, never>;
}

/**
 * Transport adapter boundary. A concrete MCP SDK adapter may implement stdio
 * and streamable HTTP without changing approval or workspace-host policy.
 */
export class ExtensionTransportClient extends Context.Service<
  ExtensionTransportClient,
  {
    readonly connect: (
      extension: InstalledExtension,
    ) => Effect.Effect<ExtensionConnection, ExtensionHostError>;
  }
>()("t3/extensions/ExtensionHost/ExtensionTransportClient") {}

const unavailableTransport = ExtensionTransportClient.of({
  connect: (extension) =>
    Effect.fail(
      new ExtensionHostError({
        operation: "connect",
        extensionId: extension.id,
        message: `No ${extension.transport.kind} MCP client adapter is bundled in this build.`,
      }),
    ),
});

export const unavailableTransportLayer = Layer.succeed(
  ExtensionTransportClient,
  unavailableTransport,
);

interface CachedWorkspaceProjection {
  readonly extensionId: ExtensionId;
  readonly providerId: string;
  readonly workspace: WorkspaceDescriptor;
  readonly observedAt: string;
}

export interface ExtensionToolInvocation {
  readonly extensionId: ExtensionId;
  readonly toolName: string;
  readonly input: unknown;
  /** Set only after the app-control policy and audit path authorizes this call. */
  readonly appControlAuthorized: true;
}

export class ExtensionHost extends Context.Service<
  ExtensionHost,
  {
    readonly list: Effect.Effect<ReadonlyArray<ExtensionRuntimeState>, ExtensionHostError>;
    readonly previewEnablement: (
      extensionId: ExtensionId,
    ) => Effect.Effect<ExtensionEnablementPreview, ExtensionHostError>;
    readonly approveAndEnable: (input: {
      readonly extensionId: ExtensionId;
      readonly identityHash: string;
      readonly capabilities: ReadonlyArray<ExtensionCapability>;
      readonly approvedAt?: string;
    }) => Effect.Effect<ExtensionRuntimeState, ExtensionHostError>;
    readonly disable: (extensionId: ExtensionId) => Effect.Effect<void, ExtensionHostError>;
    readonly listTools: (
      extensionId: ExtensionId,
    ) => Effect.Effect<ReadonlyArray<ExtensionToolDescriptor>, ExtensionHostError>;
    readonly listResources: (
      extensionId: ExtensionId,
    ) => Effect.Effect<ReadonlyArray<ExtensionResourceDescriptor>, ExtensionHostError>;
    readonly invokeTool: (
      input: ExtensionToolInvocation,
    ) => Effect.Effect<unknown, ExtensionHostError>;
    readonly readResource: (input: {
      readonly extensionId: ExtensionId;
      readonly uri: string;
    }) => Effect.Effect<unknown, ExtensionHostError>;
    readonly detectWorkspace: (input: {
      readonly extensionId: ExtensionId;
      readonly projectRoot: string;
    }) => Effect.Effect<WorkspaceDetection, ExtensionHostError>;
    readonly refreshWorkspaces: (
      extensionId: ExtensionId,
    ) => Effect.Effect<ReadonlyArray<ObservedWorkspaceProjection>, ExtensionHostError>;
    readonly observedWorkspaces: (input?: {
      readonly extensionId?: ExtensionId;
      readonly staleAfterMs?: number;
      readonly nowMs?: number;
    }) => Effect.Effect<ReadonlyArray<ObservedWorkspaceProjection>>;
    readonly describeWorkspace: (input: {
      readonly extensionId: ExtensionId;
      readonly workspaceId: string;
    }) => Effect.Effect<WorkspaceDetail, ExtensionHostError>;
    readonly createWorkspace: (input: {
      readonly extensionId: ExtensionId;
      readonly args: unknown;
      readonly appControlAuthorized: true;
    }) => Effect.Effect<AsyncWorkspaceOperation, ExtensionHostError>;
    readonly listWorkspaceActions: (input: {
      readonly extensionId: ExtensionId;
      readonly workspaceId: string;
    }) => Effect.Effect<ReadonlyArray<WorkspaceAction>, ExtensionHostError>;
    readonly invokeWorkspaceAction: (input: {
      readonly extensionId: ExtensionId;
      readonly workspaceId: string;
      readonly actionId: string;
      readonly args: unknown;
      readonly appControlAuthorized: true;
    }) => Effect.Effect<AsyncWorkspaceOperation, ExtensionHostError>;
  }
>()("t3/extensions/ExtensionHost") {}

const identityPayload = (extension: InstalledExtension): string =>
  JSON.stringify({
    id: extension.id,
    transport:
      extension.transport.kind === "stdio"
        ? {
            kind: extension.transport.kind,
            executable: extension.transport.executable,
            args: extension.transport.args,
          }
        : { kind: extension.transport.kind, url: extension.transport.url },
    requestedCapabilities: [...extension.requestedCapabilities].sort(),
  });

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const extensionIdentityHash = Effect.fn("ExtensionHost.extensionIdentityHash")(function* (
  extension: InstalledExtension,
) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest(
    "SHA-256",
    new TextEncoder().encode(identityPayload(extension)),
  );
  return bytesToHex(digest);
});

const approvalIsValid = (extension: InstalledExtension, identityHash: string): boolean => {
  const approval = extension.approval;
  if (approval === null || approval.identityHash !== identityHash) return false;
  const approved = new Set(approval.capabilities);
  return extension.requestedCapabilities.every((capability) => approved.has(capability));
};

export const make = Effect.gen(function* ExtensionHostMake() {
  const transport = yield* ExtensionTransportClient;
  const settings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const clock = yield* Clock.Clock;
  const projections = yield* Ref.make<ReadonlyMap<string, CachedWorkspaceProjection>>(new Map());
  const connections = yield* Ref.make<
    ReadonlyMap<
      ExtensionId,
      { readonly identityHash: string; readonly connection: ExtensionConnection }
    >
  >(new Map());

  yield* Effect.addFinalizer(() =>
    Ref.get(connections).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(current.values(), ({ connection }) => connection.disconnect ?? Effect.void, {
          discard: true,
        }),
      ),
    ),
  );

  const disconnectCached = Effect.fn("ExtensionHost.disconnectCached")(function* (
    extensionId: ExtensionId,
  ) {
    const cached = (yield* Ref.get(connections)).get(extensionId);
    if (cached?.connection.disconnect !== undefined) yield* cached.connection.disconnect;
    yield* Ref.update(connections, (current) => {
      const next = new Map(current);
      next.delete(extensionId);
      return next;
    });
  });

  const identityHashFor = Effect.fn("ExtensionHost.identityHashFor")(function* (
    extension: InstalledExtension,
  ) {
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(identityPayload(extension)))
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionHostError({
              operation: "inspect",
              extensionId: extension.id,
              message: "Extension identity could not be hashed.",
              cause,
            }),
        ),
      );
    return bytesToHex(digest);
  });

  const findExtension = Effect.fn("ExtensionHost.findExtension")(function* (
    extensionId: ExtensionId,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionHostError({
            operation: "inspect",
            extensionId,
            message: "Extension settings are unavailable.",
            cause,
          }),
      ),
    );
    const extension = current.extensions.find((candidate) => candidate.id === extensionId);
    if (extension === undefined) {
      return yield* new ExtensionHostError({
        operation: "inspect",
        extensionId,
        message: "Extension is not installed.",
      });
    }
    return { current, extension };
  });

  const previewEnablement = Effect.fn("ExtensionHost.previewEnablement")(function* (
    extensionId: ExtensionId,
  ) {
    const { extension } = yield* findExtension(extensionId);
    return {
      id: extension.id,
      title: extension.title,
      transport: extension.transport,
      requestedCapabilities: extension.requestedCapabilities,
      identityHash: yield* identityHashFor(extension),
    } satisfies ExtensionEnablementPreview;
  });

  const runtimeState = Effect.fn("ExtensionHost.runtimeState")(function* (
    extension: InstalledExtension,
  ) {
    const identityHash = yield* identityHashFor(extension);
    const valid = approvalIsValid(extension, identityHash);
    if (!extension.enabled || !valid) yield* disconnectCached(extension.id);
    return {
      extension,
      identityHash,
      status: !extension.enabled ? "disabled" : valid ? "ready" : "approval-required",
      ...(!extension.enabled || valid
        ? {}
        : { message: "Transport identity or requested capabilities changed; approve again." }),
    } satisfies ExtensionRuntimeState;
  });

  const list = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionHostError({
            operation: "inspect",
            extensionId: "<all>",
            message: "Extension settings are unavailable.",
            cause,
          }),
      ),
    );
    return yield* Effect.forEach(current.extensions, runtimeState);
  });

  const approveAndEnable = Effect.fn("ExtensionHost.approveAndEnable")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly identityHash: string;
    readonly capabilities: ReadonlyArray<ExtensionCapability>;
    readonly approvedAt?: string;
  }) {
    const { current, extension } = yield* findExtension(input.extensionId);
    const identityHash = yield* identityHashFor(extension);
    if (identityHash !== input.identityHash) {
      return yield* new ExtensionHostError({
        operation: "approve",
        extensionId: input.extensionId,
        message: "Extension identity changed after the enablement preview.",
      });
    }
    const approved = new Set(input.capabilities);
    if (extension.requestedCapabilities.some((capability) => !approved.has(capability))) {
      return yield* new ExtensionHostError({
        operation: "approve",
        extensionId: input.extensionId,
        message: "Approval must cover every requested extension capability.",
      });
    }
    const approvedAt = input.approvedAt ?? DateTime.formatIso(yield* DateTime.now);
    const next: InstalledExtension = {
      ...extension,
      enabled: true,
      approval: {
        identityHash,
        capabilities: [...input.capabilities],
        approvedAt,
      },
    };
    yield* settings
      .updateSettings({
        extensions: current.extensions.map((candidate) =>
          candidate.id === input.extensionId ? next : candidate,
        ),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionHostError({
              operation: "approve",
              extensionId: input.extensionId,
              message: "Extension approval could not be persisted.",
              cause,
            }),
        ),
      );
    return yield* runtimeState(next);
  });

  const disable = Effect.fn("ExtensionHost.disable")(function* (extensionId: ExtensionId) {
    const { current, extension } = yield* findExtension(extensionId);
    yield* settings
      .updateSettings({
        extensions: current.extensions.map((candidate) =>
          candidate.id === extensionId ? { ...extension, enabled: false } : candidate,
        ),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExtensionHostError({
              operation: "approve",
              extensionId,
              message: "Extension could not be disabled.",
              cause,
            }),
        ),
      );
    yield* disconnectCached(extensionId);
  });

  const connect = Effect.fn("ExtensionHost.connect")(function* (extensionId: ExtensionId) {
    const { extension } = yield* findExtension(extensionId);
    const identityHash = yield* identityHashFor(extension);
    if (!extension.enabled || !approvalIsValid(extension, identityHash)) {
      yield* disconnectCached(extensionId);
      return yield* new ExtensionHostError({
        operation: "connect",
        extensionId,
        message: extension.enabled
          ? "Extension identity requires fresh approval."
          : "Extension is disabled.",
      });
    }
    const cached = (yield* Ref.get(connections)).get(extensionId);
    if (cached?.identityHash === identityHash) return cached.connection;
    if (cached !== undefined) yield* disconnectCached(extensionId);
    const connection = yield* transport.connect(extension);
    yield* Ref.update(connections, (current) =>
      new Map(current).set(extensionId, { identityHash, connection }),
    );
    return connection;
  });

  const requireCapability = Effect.fn("ExtensionHost.requireCapability")(function* (
    extensionId: ExtensionId,
    capability: ExtensionCapability,
    operation: ExtensionHostError["operation"],
  ) {
    const { extension } = yield* findExtension(extensionId);
    if (!extension.requestedCapabilities.includes(capability)) {
      return yield* new ExtensionHostError({
        operation,
        extensionId,
        message: `Extension is not approved for the ${capability} capability.`,
      });
    }
  });

  const requireWorkspaceProvider = Effect.fn("ExtensionHost.requireWorkspaceProvider")(function* (
    extensionId: ExtensionId,
  ) {
    yield* requireCapability(extensionId, "workspace-provider", "workspace-list");
    const connection = yield* connect(extensionId);
    if (connection.workspaceProvider === undefined) {
      return yield* new ExtensionHostError({
        operation: "workspace-list",
        extensionId,
        message: "Extension does not expose t3.workspace-provider/v1.",
      });
    }
    return connection.workspaceProvider;
  });

  const listTools = Effect.fn("ExtensionHost.listTools")(function* (extensionId: ExtensionId) {
    yield* requireCapability(extensionId, "tools", "list-tools");
    const connection = yield* connect(extensionId);
    return yield* connection.listTools;
  });

  const listResources = Effect.fn("ExtensionHost.listResources")(function* (
    extensionId: ExtensionId,
  ) {
    yield* requireCapability(extensionId, "resources", "read-resource");
    const connection = yield* connect(extensionId);
    if (connection.listResources === undefined) {
      return yield* new ExtensionHostError({
        operation: "read-resource",
        extensionId,
        message: "Extension transport does not support resources/list.",
      });
    }
    return yield* connection.listResources;
  });

  const invokeTool = Effect.fn("ExtensionHost.invokeTool")(function* (
    input: ExtensionToolInvocation,
  ) {
    yield* requireCapability(input.extensionId, "tools", "invoke-tool");
    const connection = yield* connect(input.extensionId);
    return yield* connection.invokeTool(input.toolName, input.input);
  });

  const readResource = Effect.fn("ExtensionHost.readResource")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly uri: string;
  }) {
    yield* requireCapability(input.extensionId, "resources", "read-resource");
    const connection = yield* connect(input.extensionId);
    return yield* connection.readResource(input.uri);
  });

  const detectWorkspace = Effect.fn("ExtensionHost.detectWorkspace")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly projectRoot: string;
  }) {
    const provider = yield* requireWorkspaceProvider(input.extensionId);
    return yield* provider.detect(input.projectRoot);
  });

  const observedWorkspaces = (
    input: {
      readonly extensionId?: ExtensionId;
      readonly staleAfterMs?: number;
      readonly nowMs?: number;
    } = {},
  ) =>
    Ref.get(projections).pipe(
      Effect.map((current) => {
        const now = input.nowMs ?? clock.currentTimeMillisUnsafe();
        const staleAfterMs = input.staleAfterMs ?? 60_000;
        return [...current.values()]
          .filter(
            (projection) =>
              input.extensionId === undefined || projection.extensionId === input.extensionId,
          )
          .map(
            (projection): ObservedWorkspaceProjection => ({
              ...projection,
              stale: now - Date.parse(projection.observedAt) > staleAfterMs,
            }),
          );
      }),
    );

  const refreshWorkspaces = Effect.fn("ExtensionHost.refreshWorkspaces")(function* (
    extensionId: ExtensionId,
  ) {
    const provider = yield* requireWorkspaceProvider(extensionId);
    const workspaces = yield* provider.list;
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Ref.update(projections, (current) => {
      const next = new Map(current);
      for (const key of next.keys()) {
        if (key.startsWith(`${extensionId}\u0000${provider.providerId}\u0000`)) next.delete(key);
      }
      for (const workspace of workspaces) {
        next.set(`${extensionId}\u0000${provider.providerId}\u0000${workspace.id}`, {
          extensionId,
          providerId: provider.providerId,
          workspace,
          observedAt,
        });
      }
      return next;
    });
    return yield* observedWorkspaces({ extensionId });
  });

  const describeWorkspace = Effect.fn("ExtensionHost.describeWorkspace")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly workspaceId: string;
  }) {
    const provider = yield* requireWorkspaceProvider(input.extensionId);
    return yield* provider.describe(input.workspaceId);
  });

  const createWorkspace = Effect.fn("ExtensionHost.createWorkspace")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly args: unknown;
    readonly appControlAuthorized: true;
  }) {
    const provider = yield* requireWorkspaceProvider(input.extensionId);
    return yield* provider.create(input.args);
  });

  const listWorkspaceActions = Effect.fn("ExtensionHost.listWorkspaceActions")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly workspaceId: string;
  }) {
    const provider = yield* requireWorkspaceProvider(input.extensionId);
    return yield* provider.listActions(input.workspaceId);
  });

  const invokeWorkspaceAction = Effect.fn("ExtensionHost.invokeWorkspaceAction")(function* (input: {
    readonly extensionId: ExtensionId;
    readonly workspaceId: string;
    readonly actionId: string;
    readonly args: unknown;
    readonly appControlAuthorized: true;
  }) {
    const provider = yield* requireWorkspaceProvider(input.extensionId);
    return yield* provider.invoke(input.workspaceId, input.actionId, input.args);
  });

  return ExtensionHost.of({
    list,
    previewEnablement,
    approveAndEnable,
    disable,
    listTools,
    listResources,
    invokeTool,
    readResource,
    detectWorkspace,
    refreshWorkspaces,
    observedWorkspaces,
    describeWorkspace,
    createWorkspace,
    listWorkspaceActions,
    invokeWorkspaceAction,
  });
});

export const layer = Layer.effect(ExtensionHost, make);
