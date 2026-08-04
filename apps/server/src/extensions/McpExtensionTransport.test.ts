// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ExtensionId, type InstalledExtension } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ExtensionTransportClient } from "./ExtensionHost.ts";
import * as McpExtensionTransport from "./McpExtensionTransport.ts";

const fixtureSource = String.raw`
  import readline from "node:readline";
  const lines = readline.createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  lines.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "fixture", version: "1" }
      }});
      return;
    }
    if (request.method === "notifications/initialized") return;
    if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [{
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object" },
        _meta: { category: "fixture" }
      }] }});
      return;
    }
    if (request.method === "tools/call") {
      send({ jsonrpc: "2.0", id: request.id, result: {
        content: [{ type: "text", text: JSON.stringify(request.params.arguments) }]
      }});
      return;
    }
    if (request.method === "resources/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { resources: [{
        uri: "fixture://status", name: "Status", mimeType: "application/json"
      }] }});
      return;
    }
    if (request.method === "resources/read") {
      send({ jsonrpc: "2.0", id: request.id, result: {
        contents: [{ uri: request.params.uri, text: "ready" }]
      }});
      return;
    }
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "unknown" } });
  });
`;

const workspaceProviderFixtureSource = String.raw`
  import readline from "node:readline";
  const lines = readline.createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  const operations = ["detect", "list", "describe", "create", "list-actions", "invoke"];
  lines.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "workspace-fixture", version: "1" }
      }});
      return;
    }
    if (request.method === "notifications/initialized") return;
    if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: operations.map((operation) => ({
        name: "workspace_" + operation,
        inputSchema: { type: "object" },
        _meta: { "t3.workspace-provider/v1": { providerId: "fixture", operation } }
      })) }});
      return;
    }
    if (request.method === "tools/call") {
      const operation = request.params.name.slice("workspace_".length);
      const values = {
        detect: { detected: true, confidence: 1, workspaceId: "orders" },
        list: [{ id: "orders", title: "Orders" }],
        describe: { workspace: { id: "orders", title: "Orders" }, actions: ["refresh"] },
        create: { operationId: "create", status: "completed", workspaceId: "orders" },
        "list-actions": [{ id: "refresh", title: "Refresh", risk: "observe", inputSchema: {} }],
        invoke: { operationId: "refresh", status: "completed", workspaceId: "orders" }
      };
      send({ jsonrpc: "2.0", id: request.id, result: { structuredContent: values[operation] } });
      return;
    }
  });
`;

const extension = (transport: InstalledExtension["transport"]): InstalledExtension => ({
  id: ExtensionId.make("fixture-transport"),
  title: "Fixture transport",
  transport,
  requestedCapabilities: ["tools", "resources"],
  enabled: true,
  approval: null,
});

it.layer(NodeServices.layer)("McpExtensionTransport", (it) => {
  it.effect("negotiates stdio MCP and correlates tools and resources requests", () =>
    Effect.gen(function* () {
      const transport = yield* ExtensionTransportClient;
      const connection = yield* transport.connect(
        extension({
          kind: "stdio",
          executable: process.execPath,
          args: ["--input-type=module", "--eval", fixtureSource],
        }),
      );

      expect(yield* connection.listTools).toEqual([
        {
          name: "echo",
          description: "Echo input",
          inputSchema: { type: "object" },
          metadata: { category: "fixture" },
        },
      ]);
      expect(yield* connection.invokeTool("echo", { value: 42 })).toMatchObject({
        content: [{ type: "text", text: '{"value":42}' }],
      });
      expect(yield* connection.listResources!).toEqual([
        { uri: "fixture://status", name: "Status", mimeType: "application/json" },
      ]);
      expect(yield* connection.readResource("fixture://status")).toMatchObject({
        contents: [{ uri: "fixture://status", text: "ready" }],
      });
      yield* connection.disconnect!;
    }).pipe(Effect.provide(McpExtensionTransport.layer)),
  );

  it.effect("fails closed for streamable HTTP until redirect-safe sessions are supported", () =>
    Effect.gen(function* () {
      const transport = yield* ExtensionTransportClient;
      const result = yield* Effect.result(
        transport.connect(
          extension({ kind: "streamable-http", url: "https://extensions.example.test/mcp" }),
        ),
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          operation: "connect",
          message:
            "Streamable HTTP MCP extensions are unavailable until origin and redirect enforcement is implemented.",
        },
      });
    }).pipe(Effect.provide(McpExtensionTransport.layer)),
  );

  it.effect("rejects a process that does not complete MCP initialization", () =>
    Effect.gen(function* () {
      const transport = yield* ExtensionTransportClient;
      const result = yield* Effect.result(
        transport.connect(
          extension({
            kind: "stdio",
            executable: process.execPath,
            args: ["--input-type=module", "--eval", 'process.stdout.write("not-json\\n")'],
          }),
        ),
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { operation: "connect", message: "Extension MCP process could not initialize." },
      });
    }).pipe(Effect.provide(McpExtensionTransport.layer)),
  );

  it.effect("discovers and proxies the generic workspace-provider metadata contract", () =>
    Effect.gen(function* () {
      const transport = yield* ExtensionTransportClient;
      const connection = yield* transport.connect(
        extension({
          kind: "stdio",
          executable: process.execPath,
          args: ["--input-type=module", "--eval", workspaceProviderFixtureSource],
        }),
      );
      expect(connection.workspaceProvider?.providerId).toBe("fixture");
      expect(yield* connection.workspaceProvider!.list).toEqual([
        { id: "orders", title: "Orders" },
      ]);
      expect(yield* connection.workspaceProvider!.detect("/worktrees/orders")).toMatchObject({
        detected: true,
        workspaceId: "orders",
      });
      expect(yield* connection.workspaceProvider!.invoke("orders", "refresh", {})).toMatchObject({
        operationId: "refresh",
        status: "completed",
      });
      yield* connection.disconnect!;
    }).pipe(Effect.provide(McpExtensionTransport.layer)),
  );
});
