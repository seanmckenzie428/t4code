import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ExtensionId, type InstalledExtension, type WorkspaceDescriptor } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as ExtensionHost from "./ExtensionHost.ts";

const extensionId = ExtensionId.make("fixture");
const installed = (overrides: Partial<InstalledExtension> = {}): InstalledExtension => ({
  id: extensionId,
  title: "Fixture MCP",
  transport: { kind: "stdio", executable: "fixture-mcp", args: ["serve", "--json"] },
  requestedCapabilities: ["tools", "workspace-provider"],
  enabled: false,
  approval: null,
  ...overrides,
});

const fakeConnection = (
  workspaces: ReadonlyArray<WorkspaceDescriptor> = [],
  onDisconnect?: () => void,
) => ({
  listTools: Effect.succeed([
    { name: "fixture_status", inputSchema: { type: "object", additionalProperties: false } },
  ]),
  invokeTool: (name: string, input: unknown) => Effect.succeed({ name, input }),
  readResource: (uri: string) => Effect.succeed({ uri }),
  disconnect: Effect.sync(() => onDisconnect?.()),
  workspaceProvider: {
    providerId: "fixture-provider",
    detect: (projectRoot: string) =>
      Effect.succeed({ detected: true, confidence: 1, workspaceId: projectRoot }),
    list: Effect.succeed(workspaces),
    describe: (workspaceId: string) =>
      Effect.succeed({
        workspace: { id: workspaceId, title: workspaceId },
        actions: ["refresh"],
      }),
    create: () => Effect.succeed({ operationId: "create-1", status: "running" as const }),
    listActions: () =>
      Effect.succeed([
        { id: "refresh", title: "Refresh", risk: "observe" as const, inputSchema: {} },
      ]),
    invoke: (_workspaceId: string, actionId: string) =>
      Effect.succeed({ operationId: actionId, status: "completed" as const }),
  },
});

const hostLayer = (input: {
  readonly extension?: InstalledExtension;
  readonly onConnect?: () => void;
  readonly onDisconnect?: () => void;
  readonly workspaces?: ReadonlyArray<WorkspaceDescriptor>;
}) => {
  const settingsLayer = ServerSettings.layerTest({
    extensions: [input.extension ?? installed()],
  });
  const extensionLayer = ExtensionHost.layer.pipe(
    Layer.provide(
      Layer.succeed(
        ExtensionHost.ExtensionTransportClient,
        ExtensionHost.ExtensionTransportClient.of({
          connect: () => {
            input.onConnect?.();
            return Effect.succeed(fakeConnection(input.workspaces, input.onDisconnect));
          },
        }),
      ),
    ),
    Layer.provide(settingsLayer),
  );
  return Layer.merge(settingsLayer, extensionLayer);
};

it.layer(NodeServices.layer)("ExtensionHost", (it) => {
  it.effect("does not connect until exact transport and capabilities are approved", () => {
    let connects = 0;
    return Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const states = yield* host.list;
      expect(states[0]?.status).toBe("disabled");
      expect(connects).toBe(0);

      const preview = yield* host.previewEnablement(extensionId);
      expect(preview.transport).toEqual({
        kind: "stdio",
        executable: "fixture-mcp",
        args: ["serve", "--json"],
      });
      expect(preview.requestedCapabilities).toEqual(["tools", "workspace-provider"]);

      const enabled = yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      expect(enabled.status).toBe("ready");
      expect(connects).toBe(0);

      expect(yield* host.listTools(extensionId)).toHaveLength(1);
      expect(connects).toBe(1);
    }).pipe(Effect.provide(hostLayer({ onConnect: () => connects++ })));
  });

  it.effect("invalidates approval after executable arguments change", () =>
    Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const settings = yield* ServerSettings.ServerSettingsService;
      const preview = yield* host.previewEnablement(extensionId);
      yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      const current = yield* settings.getSettings;
      yield* settings.updateSettings({
        extensions: current.extensions.map((extension) => ({
          ...extension,
          transport: { kind: "stdio" as const, executable: "fixture-mcp", args: ["changed"] },
        })),
      });
      expect((yield* host.list)[0]).toMatchObject({ status: "approval-required" });
      const result = yield* Effect.result(host.listTools(extensionId));
      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(hostLayer({}))),
  );

  it.effect("reuses an approved connection and disconnects it on identity drift", () => {
    let connects = 0;
    let disconnects = 0;
    return Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const settings = yield* ServerSettings.ServerSettingsService;
      const preview = yield* host.previewEnablement(extensionId);
      yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      yield* host.listTools(extensionId);
      yield* host.listTools(extensionId);
      expect(connects).toBe(1);

      const current = yield* settings.getSettings;
      yield* settings.updateSettings({
        extensions: current.extensions.map((candidate) => ({
          ...candidate,
          transport: { kind: "stdio" as const, executable: "fixture-mcp", args: ["drift"] },
        })),
      });
      yield* host.list;
      expect(disconnects).toBe(1);
    }).pipe(
      Effect.provide(
        hostLayer({
          onConnect: () => connects++,
          onDisconnect: () => disconnects++,
        }),
      ),
    );
  });

  it.effect("requires the approved capability before exposing a transport operation", () =>
    Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const preview = yield* host.previewEnablement(extensionId);
      yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      const result = yield* Effect.result(host.listResources(extensionId));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          operation: "read-resource",
          message: "Extension is not approved for the resources capability.",
        },
      });
    }).pipe(Effect.provide(hostLayer({}))),
  );

  it.effect("caches only observed workspace projections and computes staleness on read", () =>
    Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const preview = yield* host.previewEnablement(extensionId);
      yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      const observed = yield* host.refreshWorkspaces(extensionId);
      expect(observed).toMatchObject([
        {
          extensionId: "fixture",
          providerId: "fixture-provider",
          workspace: { id: "one", title: "One" },
          stale: false,
        },
      ]);
      const observedAt = Date.parse(observed[0]!.observedAt);
      expect(
        (yield* host.observedWorkspaces({ staleAfterMs: 100, nowMs: observedAt + 101 }))[0]?.stale,
      ).toBe(true);
    }).pipe(
      Effect.provide(hostLayer({ workspaces: [{ id: "one", title: "One", status: "healthy" }] })),
    ),
  );

  it.effect("fails closed when the build has no MCP transport adapter", () =>
    Effect.gen(function* () {
      const host = yield* ExtensionHost.ExtensionHost;
      const preview = yield* host.previewEnablement(extensionId);
      yield* host.approveAndEnable({
        extensionId,
        identityHash: preview.identityHash,
        capabilities: preview.requestedCapabilities,
        approvedAt: "2026-08-01T12:00:00.000Z",
      });
      const result = yield* Effect.result(host.listTools(extensionId));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          operation: "connect",
          message: "No stdio MCP client adapter is bundled in this build.",
        },
      });
    }).pipe(
      Effect.provide(
        ExtensionHost.layer.pipe(
          Layer.provide(ExtensionHost.unavailableTransportLayer),
          Layer.provide(ServerSettings.layerTest({ extensions: [installed()] })),
        ),
      ),
    ),
  );
});
