// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - This adapter owns a Node subprocess and enforces wall-clock protocol deadlines.
import * as NodeChildProcess from "node:child_process";

import type { InstalledExtension } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type ExtensionConnection,
  ExtensionHostError,
  ExtensionTransportClient,
} from "./ExtensionHost.ts";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const WORKSPACE_PROVIDER_METADATA_KEY = "t3.workspace-provider/v1";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly cleanupAbort: () => void;
}

class StdioJsonRpcClient {
  readonly #child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #buffer = Buffer.alloc(0);
  #closed = false;
  #closeError: Error | undefined;

  private constructor(child: NodeChildProcess.ChildProcessWithoutNullStreams) {
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
    // Consume stderr so a verbose extension cannot block on a full pipe. Its
    // contents may contain credentials and are deliberately never logged.
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => this.#close(error));
    child.once("exit", (code, signal) => {
      this.#close(
        new Error(
          `Extension process exited${code === null ? "" : ` with code ${code}`}${signal === null ? "" : ` (${signal})`}.`,
        ),
      );
    });
  }

  static async connect(extension: InstalledExtension): Promise<StdioJsonRpcClient> {
    if (extension.transport.kind !== "stdio") {
      throw new Error("Only stdio extensions can use the stdio transport.");
    }
    const child = NodeChildProcess.spawn(
      extension.transport.executable,
      [...extension.transport.args],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const client = new StdioJsonRpcClient(child);
    try {
      const initialized = await client.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "t3-code", version: "1" },
      });
      if (!isRecord(initialized) || typeof initialized.protocolVersion !== "string") {
        throw new Error("Extension returned an invalid initialize result.");
      }
      client.notify("notifications/initialized", {});
      return client;
    } catch (error) {
      client.disconnect();
      throw error;
    }
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.#closed) return Promise.reject(this.#closeError ?? new Error("Connection closed."));
    const id = this.#nextId++;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    if (Buffer.byteLength(message) > MAX_REQUEST_BYTES) {
      return Promise.reject(new Error("MCP request exceeds the 1 MiB limit."));
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new Error("MCP request was cancelled."));
        return;
      }
      const abort = () => {
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        clearTimeout(pending.timeout);
        pending.cleanupAbort();
        this.#pending.delete(id);
        this.notify("notifications/cancelled", {
          requestId: id,
          reason: "T3 request was cancelled.",
        });
        pending.reject(new Error("MCP request was cancelled."));
      };
      signal?.addEventListener("abort", abort, { once: true });
      const cleanupAbort = () => signal?.removeEventListener("abort", abort);
      const timeout = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        pending.cleanupAbort();
        this.#pending.delete(id);
        this.notify("notifications/cancelled", {
          requestId: id,
          reason: "T3 request timed out.",
        });
        reject(new Error(`MCP request timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timeout, cleanupAbort });
      this.#child.stdin.write(`${message}\n`, (error) => {
        if (error === null || error === undefined) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        clearTimeout(pending.timeout);
        pending.cleanupAbort();
        this.#pending.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.#closed) return;
    const message = JSON.stringify({ jsonrpc: "2.0", method, params });
    if (Buffer.byteLength(message) <= MAX_REQUEST_BYTES) this.#child.stdin.write(`${message}\n`);
  }

  disconnect(): void {
    if (this.#closed) return;
    this.#close(new Error("Extension connection was closed."));
    this.#child.stdin.end();
    // This handle refers to the exact process spawned above; no PID lookup or
    // name matching is involved.
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        if (this.#child.exitCode === null && this.#child.signalCode === null) {
          this.#child.kill("SIGKILL");
        }
      }, 2_000);
      forceKill.unref();
      this.#child.once("exit", () => clearTimeout(forceKill));
    }
  }

  #onData(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > MAX_MESSAGE_BYTES) {
      this.disconnect();
      return;
    }
    for (;;) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line.length === 0) continue;
      if (line.length > MAX_MESSAGE_BYTES) {
        this.disconnect();
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(line.toString("utf8"));
      } catch {
        this.disconnect();
        return;
      }
      this.#onMessage(message);
    }
  }

  #onMessage(message: unknown): void {
    if (!isRecord(message) || message.jsonrpc !== "2.0") return;
    if ((typeof message.id === "number" || typeof message.id === "string") && "method" in message) {
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Client method not supported." },
      });
      if (!this.#closed) this.#child.stdin.write(`${response}\n`);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    pending.cleanupAbort();
    this.#pending.delete(message.id);
    if (isRecord(message.error)) {
      pending.reject(
        new Error(
          typeof message.error.message === "string"
            ? message.error.message
            : "Extension returned an MCP error.",
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  #close(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeError = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

const transportError = (
  extension: InstalledExtension,
  operation: "connect" | "list-tools" | "invoke-tool" | "read-resource",
  message: string,
  cause?: unknown,
) =>
  new ExtensionHostError({
    operation,
    extensionId: extension.id,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const runRequest = (
  extension: InstalledExtension,
  operation: "list-tools" | "invoke-tool" | "read-resource",
  request: (signal: AbortSignal) => Promise<unknown>,
) =>
  Effect.tryPromise({
    try: request,
    catch: (cause) => transportError(extension, operation, errorMessage(cause), cause),
  });

const parseToolList = (
  result: unknown,
):
  | ReadonlyArray<{
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: JsonRecord;
      readonly metadata?: JsonRecord;
    }>
  | undefined => {
  if (!isRecord(result) || !Array.isArray(result.tools)) return undefined;
  return result.tools.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || !isRecord(tool.inputSchema)) return [];
    return [
      {
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
        ...(isRecord(tool._meta) ? { metadata: tool._meta } : {}),
      },
    ];
  });
};

const structuredResult = (value: unknown): unknown =>
  isRecord(value) && "structuredContent" in value ? value.structuredContent : value;

const discoverWorkspaceProvider = (
  extension: InstalledExtension,
  client: StdioJsonRpcClient,
  listedTools: ReadonlyArray<{
    readonly name: string;
    readonly metadata?: JsonRecord;
  }>,
): ExtensionConnection["workspaceProvider"] => {
  const operations = new Map<string, string>();
  let providerId: string | undefined;
  for (const tool of listedTools) {
    const metadata = tool.metadata?.[WORKSPACE_PROVIDER_METADATA_KEY];
    if (!isRecord(metadata)) continue;
    if (typeof metadata.providerId !== "string" || typeof metadata.operation !== "string") continue;
    if (providerId !== undefined && providerId !== metadata.providerId) return undefined;
    providerId = metadata.providerId;
    operations.set(metadata.operation, tool.name);
  }
  if (providerId === undefined) return undefined;
  const requiredOperations = ["detect", "list", "describe", "create", "list-actions", "invoke"];
  if (requiredOperations.some((operation) => !operations.has(operation))) return undefined;

  const call = (
    operation: string,
    input: unknown,
    hostOperation: ExtensionHostError["operation"],
  ) =>
    runRequest(extension, "invoke-tool", (signal) =>
      client.request("tools/call", { name: operations.get(operation), arguments: input }, signal),
    ).pipe(
      Effect.map(structuredResult),
      Effect.mapError(
        (cause) =>
          new ExtensionHostError({
            operation: hostOperation,
            extensionId: extension.id,
            message: cause.message,
            cause,
          }),
      ),
    );

  return {
    providerId,
    detect: (projectRoot) =>
      call("detect", { projectRoot }, "workspace-detect").pipe(
        Effect.flatMap((result) =>
          isRecord(result) && typeof result.detected === "boolean"
            ? Effect.succeed(result as never)
            : Effect.fail(
                new ExtensionHostError({
                  operation: "workspace-detect",
                  extensionId: extension.id,
                  message: "Workspace provider returned an invalid detect result.",
                }),
              ),
        ),
      ),
    list: call("list", {}, "workspace-list").pipe(
      Effect.flatMap((result) =>
        Array.isArray(result)
          ? Effect.succeed(result as never)
          : Effect.fail(
              new ExtensionHostError({
                operation: "workspace-list",
                extensionId: extension.id,
                message: "Workspace provider returned an invalid list result.",
              }),
            ),
      ),
    ),
    describe: (workspaceId) =>
      call("describe", { workspaceId }, "workspace-describe").pipe(
        Effect.flatMap((result) =>
          isRecord(result) && isRecord(result.workspace) && Array.isArray(result.actions)
            ? Effect.succeed(result as never)
            : Effect.fail(
                new ExtensionHostError({
                  operation: "workspace-describe",
                  extensionId: extension.id,
                  message: "Workspace provider returned an invalid describe result.",
                }),
              ),
        ),
      ),
    create: (input) =>
      call("create", input, "workspace-create").pipe(
        Effect.flatMap((result) =>
          isRecord(result) &&
          typeof result.operationId === "string" &&
          typeof result.status === "string"
            ? Effect.succeed(result as never)
            : Effect.fail(
                new ExtensionHostError({
                  operation: "workspace-create",
                  extensionId: extension.id,
                  message: "Workspace provider returned an invalid create receipt.",
                }),
              ),
        ),
      ),
    listActions: (workspaceId) =>
      call("list-actions", { workspaceId }, "workspace-list-actions").pipe(
        Effect.flatMap((result) =>
          Array.isArray(result)
            ? Effect.succeed(result as never)
            : Effect.fail(
                new ExtensionHostError({
                  operation: "workspace-list-actions",
                  extensionId: extension.id,
                  message: "Workspace provider returned invalid actions.",
                }),
              ),
        ),
      ),
    invoke: (workspaceId, actionId, args) =>
      call("invoke", { workspaceId, actionId, args }, "workspace-invoke").pipe(
        Effect.flatMap((result) =>
          isRecord(result) &&
          typeof result.operationId === "string" &&
          typeof result.status === "string"
            ? Effect.succeed(result as never)
            : Effect.fail(
                new ExtensionHostError({
                  operation: "workspace-invoke",
                  extensionId: extension.id,
                  message: "Workspace provider returned an invalid action receipt.",
                }),
              ),
        ),
      ),
  };
};

const toConnection = (
  extension: InstalledExtension,
  client: StdioJsonRpcClient,
  initialToolList?: unknown,
): ExtensionConnection => {
  const parsedInitialTools = parseToolList(initialToolList);
  const listTools =
    parsedInitialTools === undefined
      ? runRequest(extension, "list-tools", (signal) =>
          client.request("tools/list", {}, signal),
        ).pipe(
          Effect.flatMap((result) => {
            const parsed = parseToolList(result);
            if (parsed !== undefined) return Effect.succeed(parsed);
            return Effect.fail(
              transportError(
                extension,
                "list-tools",
                "Extension returned an invalid tools/list result.",
              ),
            );
          }),
        )
      : Effect.succeed(parsedInitialTools);
  const workspaceProvider =
    parsedInitialTools === undefined
      ? undefined
      : discoverWorkspaceProvider(extension, client, parsedInitialTools);
  return {
    listTools,
    ...(workspaceProvider === undefined ? {} : { workspaceProvider }),
    listResources: runRequest(extension, "read-resource", (signal) =>
      client.request("resources/list", {}, signal),
    ).pipe(
      Effect.flatMap((result) => {
        if (!isRecord(result) || !Array.isArray(result.resources)) {
          return Effect.fail(
            transportError(
              extension,
              "read-resource",
              "Extension returned an invalid resources/list result.",
            ),
          );
        }
        return Effect.succeed(
          result.resources.flatMap((resource) => {
            if (!isRecord(resource) || typeof resource.uri !== "string") return [];
            return [
              {
                ...resource,
                uri: resource.uri,
                ...(typeof resource.name === "string" ? { name: resource.name } : {}),
                ...(typeof resource.description === "string"
                  ? { description: resource.description }
                  : {}),
                ...(typeof resource.mimeType === "string" ? { mimeType: resource.mimeType } : {}),
              },
            ];
          }),
        );
      }),
    ),
    invokeTool: (name, input) =>
      runRequest(extension, "invoke-tool", (signal) =>
        client.request("tools/call", { name, arguments: input }, signal),
      ),
    readResource: (uri) =>
      runRequest(extension, "read-resource", (signal) =>
        client.request("resources/read", { uri }, signal),
      ),
    disconnect: Effect.sync(() => client.disconnect()),
  };
};

export const make = ExtensionTransportClient.of({
  connect: (extension) => {
    if (extension.transport.kind === "streamable-http") {
      return Effect.fail(
        transportError(
          extension,
          "connect",
          "Streamable HTTP MCP extensions are unavailable until origin and redirect enforcement is implemented.",
        ),
      );
    }
    return Effect.tryPromise({
      try: async () => {
        const client = await StdioJsonRpcClient.connect(extension);
        const initialToolList = await client.request("tools/list", {}).catch(() => undefined);
        return { client, initialToolList };
      },
      catch: (cause) =>
        transportError(extension, "connect", "Extension MCP process could not initialize.", cause),
    }).pipe(
      Effect.map(({ client, initialToolList }) => toConnection(extension, client, initialToolList)),
    );
  },
});

export const layer = Layer.succeed(ExtensionTransportClient, make);
