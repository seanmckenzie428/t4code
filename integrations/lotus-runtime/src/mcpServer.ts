// @effect-diagnostics nodeBuiltinImport:off - Standalone MCP stdio server.
import * as NodeReadline from "node:readline";
import type * as NodeStream from "node:stream";

import { isRecord } from "./lotusCli.ts";
import { LotusWorkspaceProvider } from "./provider.ts";
import type { JsonRecord } from "./types.ts";

const MAX_REQUEST_BYTES = 1024 * 1024;
const PROVIDER_METADATA_KEY = "t3.workspace-provider/v1";

const objectSchema = (
  properties: JsonRecord = {},
  required: ReadonlyArray<string> = [],
): JsonRecord => ({ type: "object", additionalProperties: false, properties, required });

const workspaceIdSchema = objectSchema({ workspaceId: { type: "string", minLength: 1 } }, [
  "workspaceId",
]);

const providerTool = (
  name: string,
  description: string,
  operation: string,
  inputSchema: JsonRecord,
) => ({
  name,
  description,
  inputSchema,
  _meta: {
    [PROVIDER_METADATA_KEY]: { providerId: "lotus", operation },
  },
});

export const tools = [
  {
    name: "lotus_status",
    description: "Read Lotus Runtime status without mutating it.",
    inputSchema: objectSchema({ slug: { type: "string", minLength: 1 } }),
  },
  {
    name: "lotus_list",
    description: "List observed Lotus Runtime workspaces.",
    inputSchema: objectSchema(),
  },
  {
    name: "lotus_explain",
    description: "Read a Lotus Runtime workspace inventory and drift report.",
    inputSchema: objectSchema({ slug: { type: "string", minLength: 1 } }, ["slug"]),
  },
  {
    name: "lotus_todo_list",
    description: "List persisted Lotus Runtime todos for a workspace.",
    inputSchema: objectSchema({ slug: { type: "string", minLength: 1 } }, ["slug"]),
  },
  providerTool(
    "lotus_workspace_detect",
    "Detect whether a project root belongs to a Lotus Runtime workspace.",
    "detect",
    objectSchema({ projectRoot: { type: "string", minLength: 1 } }, ["projectRoot"]),
  ),
  providerTool(
    "lotus_workspace_list",
    "List Lotus Runtime workspaces for adoption and refresh.",
    "list",
    objectSchema(),
  ),
  providerTool(
    "lotus_workspace_describe",
    "Describe a Lotus Runtime workspace and its cockpit actions.",
    "describe",
    workspaceIdSchema,
  ),
  providerTool(
    "lotus_workspace_create",
    "Create a Lotus Runtime workspace; the runtime remains lifecycle owner.",
    "create",
    objectSchema(
      {
        slug: { type: "string", minLength: 1 },
        branch: { type: "string", minLength: 1 },
        operationId: { type: "string", minLength: 1 },
      },
      ["slug"],
    ),
  ),
  providerTool(
    "lotus_workspace_list_actions",
    "List available Lotus Runtime workspace actions and risk tiers.",
    "list-actions",
    workspaceIdSchema,
  ),
  providerTool(
    "lotus_workspace_invoke",
    "Invoke an authorized Lotus Runtime workspace action.",
    "invoke",
    objectSchema(
      {
        workspaceId: { type: "string", minLength: 1 },
        actionId: { type: "string", minLength: 1 },
        args: { type: "object" },
      },
      ["workspaceId", "actionId"],
    ),
  ),
  {
    name: "lotus_operation_get",
    description: "Read a previously issued idempotent Lotus operation receipt.",
    inputSchema: objectSchema({ operationId: { type: "string", minLength: 1 } }, ["operationId"]),
  },
] as const;

const requiredString = (input: JsonRecord, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required.`);
  return value;
};

export class LotusMcpServer {
  readonly #provider: LotusWorkspaceProvider;

  constructor(provider = new LotusWorkspaceProvider()) {
    this.#provider = provider;
  }

  async callTool(name: string, inputValue: unknown): Promise<unknown> {
    const input = isRecord(inputValue) ? inputValue : {};
    switch (name) {
      case "lotus_status":
        return this.#provider.status(typeof input.slug === "string" ? input.slug : undefined);
      case "lotus_list":
      case "lotus_workspace_list":
        return this.#provider.list();
      case "lotus_explain":
        return this.#provider.explain(requiredString(input, "slug"));
      case "lotus_todo_list":
        return this.#provider.todoList(requiredString(input, "slug"));
      case "lotus_workspace_detect":
        return this.#provider.detect(requiredString(input, "projectRoot"));
      case "lotus_workspace_describe":
        return this.#provider.describe(requiredString(input, "workspaceId"));
      case "lotus_workspace_create":
        return this.#provider.create(input);
      case "lotus_workspace_list_actions":
        return this.#provider.listActions();
      case "lotus_workspace_invoke":
        return this.#provider.invoke(
          requiredString(input, "workspaceId"),
          requiredString(input, "actionId"),
          input.args,
        );
      case "lotus_operation_get": {
        const receipt = this.#provider.getOperation(requiredString(input, "operationId"));
        if (receipt === undefined) throw new Error("Lotus operation receipt was not found.");
        return receipt;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async handle(message: unknown): Promise<JsonRecord | undefined> {
    if (!isRecord(message) || message.jsonrpc !== "2.0") return undefined;
    if (message.method === "notifications/initialized") return undefined;
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    try {
      switch (message.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "t3-lotus-runtime", version: "0.1.0" },
            },
          };
        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools } };
        case "tools/call": {
          if (!isRecord(message.params)) throw new Error("tools/call params are invalid.");
          const name = requiredString(message.params, "name");
          const result = await this.callTool(name, message.params.arguments);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            },
          };
        }
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found." },
          };
      }
    } catch (cause) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: cause instanceof Error ? cause.message : "Lotus Runtime extension failed.",
        },
      };
    }
  }
}

export const serveStdio = (
  server = new LotusMcpServer(),
  input: NodeStream.Readable = process.stdin,
  output: NodeStream.Writable = process.stdout,
): void => {
  const lines = NodeReadline.createInterface({ input });
  lines.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) {
      output.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request exceeds 1 MiB." } })}\n`,
      );
      return;
    }
    let request: unknown;
    try {
      request = JSON.parse(line) as unknown;
    } catch {
      output.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } })}\n`,
      );
      return;
    }
    void server.handle(request).then((response) => {
      if (response !== undefined) output.write(`${JSON.stringify(response)}\n`);
    });
  });
};
