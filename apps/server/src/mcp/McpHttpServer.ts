import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { McpProtocol, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import packageJson from "../../package.json" with { type: "json" };
import * as ProcessRunner from "../processRunner.ts";
import { AppControlToolkitHandlersLive } from "./toolkits/app/handlers.ts";
import * as AppControlAudit from "./AppControlAudit.ts";
import * as AppControlPolicy from "./AppControlPolicy.ts";
import * as AppControlServerExecutor from "./AppControlServerExecutor.ts";
import * as AppControlTerminalCommandRunner from "./AppControlTerminalCommandRunner.ts";
import { AppControlToolkit } from "./toolkits/app/tools.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import {
  PreviewHighlightToolkitHandlersLive,
  PreviewSnapshotToolkitHandlersLive,
  PreviewStandardToolkitHandlersLive,
} from "./toolkits/preview/handlers.ts";
import {
  PreviewHighlightTool,
  PreviewHighlightToolkit,
  PreviewHighlightUpdateTool,
  PreviewSnapshotTool,
  PreviewSnapshotToolkit,
  PreviewStandardToolkit,
} from "./toolkits/preview/tools.ts";

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": "Bearer",
    },
  },
);

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

export const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

const makeMcpAuthMiddleware = (requiredCapability: McpInvocationContext.McpCapability) =>
  McpSessionRegistry.McpSessionRegistry.pipe(
    Effect.map(
      (registry): McpAuthMiddleware =>
        Effect.fn("McpHttpServer.authenticateRequest")(function* (httpEffect) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const authorization = request.headers.authorization;
          const token =
            authorization?.startsWith("Bearer ") === true
              ? authorization.slice("Bearer ".length).trim()
              : "";
          const invocation = yield* registry.resolve(token);
          if (!invocation || !invocation.capabilities.has(requiredCapability)) {
            // Without this the only symptom of a dead credential is the agent
            // quietly losing the whole `t3-code` toolkit for the rest of its
            // session, with nothing on the server to explain why.
            yield* Effect.logWarning("rejected MCP request with an unusable credential", {
              reason:
                token.length === 0
                  ? "missing_bearer_token"
                  : invocation
                    ? "missing_required_capability"
                    : "unknown_or_expired_token",
              requiredCapability,
            });
            return unauthorized;
          }
          return yield* httpEffect.pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.map(normalizeMcpHttpResponse),
          );
        }),
    ),
    Effect.withSpan("McpHttpServer.makeAuthMiddleware", { attributes: { requiredCapability } }),
  );

const makeMcpAuthMiddlewareLive = (requiredCapability: McpInvocationContext.McpCapability) =>
  HttpRouter.middleware<{
    provides: McpInvocationContext.McpInvocationContext;
  }>()(makeMcpAuthMiddleware(requiredCapability)).layer;

const previewSnapshotFailure = <E>(cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const failures = cause.reasons.filter(Cause.isFailReason);
  const firstFailure = failures[0]?.error;
  const errorTag =
    typeof firstFailure === "object" &&
    firstFailure !== null &&
    "_tag" in firstFailure &&
    typeof firstFailure._tag === "string"
      ? firstFailure._tag
      : "PreviewSnapshotError";
  const result = new McpSchema.CallToolResult({
    isError: true,
    structuredContent: {
      error: {
        _tag: errorTag,
        operation: "snapshot",
        failureCount: failures.length,
      },
    },
    content: [{ type: "text", text: "Preview snapshot failed." }],
  });
  return Effect.logWarning("preview snapshot failed", {
    operation: "snapshot",
    errorTag,
    failureCount: failures.length,
  }).pipe(Effect.as(result));
};

const registerPreviewSnapshot = Effect.fn("McpHttpServer.registerPreviewSnapshot")(function* () {
  const server = yield* McpServer.McpServer;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const built = yield* PreviewSnapshotToolkit;
  const tool = PreviewSnapshotTool;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle("preview_snapshot", payload).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.matchCauseEffect({
            onFailure: previewSnapshotFailure,
            onSuccess: ({ encodedResult }) => {
              const snapshot = encodedResult as {
                readonly screenshot: {
                  readonly mimeType: "image/png";
                  readonly data: string;
                  readonly width: number;
                  readonly height: number;
                };
                readonly [key: string]: unknown;
              };
              const { screenshot, ...page } = snapshot;
              const metadata = {
                ...page,
                screenshot: {
                  mimeType: screenshot.mimeType,
                  width: screenshot.width,
                  height: screenshot.height,
                },
              };
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: metadata,
                  content: [
                    { type: "text", text: JSON.stringify(metadata) },
                    {
                      type: "image",
                      data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                      mimeType: screenshot.mimeType,
                    },
                  ],
                }),
              );
            },
          }),
        );
      }),
  });
});

const previewHighlightFailure =
  (operation: "highlightApply" | "highlightUpdate") =>
  <E>(cause: Cause.Cause<E>) => {
    if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
      return Effect.failCause(cause).pipe(Effect.orDie);
    }
    const failures = cause.reasons.filter(Cause.isFailReason);
    const firstFailure = failures[0]?.error;
    const errorTag =
      typeof firstFailure === "object" &&
      firstFailure !== null &&
      "_tag" in firstFailure &&
      typeof firstFailure._tag === "string"
        ? firstFailure._tag
        : "PreviewHighlightError";
    const result = new McpSchema.CallToolResult({
      isError: true,
      structuredContent: {
        error: { _tag: errorTag, operation, failureCount: failures.length },
      },
      content: [{ type: "text", text: "Preview highlighting failed." }],
    });
    return Effect.logWarning("preview highlighting failed", {
      operation,
      errorTag,
      failureCount: failures.length,
    }).pipe(Effect.as(result));
  };

const registerPreviewHighlights = Effect.fn("McpHttpServer.registerPreviewHighlights")(
  function* () {
    const server = yield* McpServer.McpServer;
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const built = yield* PreviewHighlightToolkit;
    const entries = [
      [PreviewHighlightTool, "preview_highlight_apply", "highlightApply"],
      [PreviewHighlightUpdateTool, "preview_highlight_update", "highlightUpdate"],
    ] as const;
    yield* Effect.forEach(entries, ([tool, name, operation]) =>
      server.addTool({
        tool: new McpSchema.Tool({
          name: tool.name,
          description: Tool.getDescription(tool),
          inputSchema: Tool.getJsonSchema(tool),
          annotations: {
            ...Context.getOption(tool.annotations, Tool.Title).pipe(
              Option.map((title) => ({ title })),
              Option.getOrUndefined,
            ),
            readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
            destructiveHint: Context.get(tool.annotations, Tool.Destructive),
            idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
            openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
          },
        }),
        annotations: tool.annotations,
        handle: (payload) =>
          Effect.withFiber((fiber) => {
            const invocation = Context.getUnsafe(
              fiber.context,
              McpInvocationContext.McpInvocationContext,
            );
            return built.handle(name, payload).pipe(
              Stream.unwrap,
              Stream.run(Sink.last()),
              Effect.flatMap(Effect.fromOption),
              Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
              Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
              Effect.matchCauseEffect({
                onFailure: previewHighlightFailure(operation),
                onSuccess: ({ encodedResult }) => {
                  const result = encodedResult as {
                    readonly screenshot?: {
                      readonly mimeType: "image/png";
                      readonly data: string;
                      readonly width: number;
                      readonly height: number;
                    };
                    readonly [key: string]: unknown;
                  };
                  const { screenshot, ...rest } = result;
                  const metadata = screenshot
                    ? {
                        ...rest,
                        screenshot: {
                          mimeType: screenshot.mimeType,
                          width: screenshot.width,
                          height: screenshot.height,
                        },
                      }
                    : rest;
                  return Effect.succeed(
                    new McpSchema.CallToolResult({
                      isError: false,
                      structuredContent: metadata,
                      content: [
                        { type: "text", text: JSON.stringify(metadata) },
                        ...(screenshot
                          ? [
                              {
                                type: "image" as const,
                                data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                                mimeType: screenshot.mimeType,
                              },
                            ]
                          : []),
                      ],
                    }),
                  );
                },
              }),
            );
          }),
      }),
    );
  },
);

const PreviewStandardToolkitRegistrationLive = McpServer.toolkit(PreviewStandardToolkit).pipe(
  Layer.provide(PreviewStandardToolkitHandlersLive),
);

const PreviewSnapshotRegistrationLive = Layer.effectDiscard(registerPreviewSnapshot()).pipe(
  Layer.provide(PreviewSnapshotToolkitHandlersLive),
);

const PreviewHighlightRegistrationLive = Layer.effectDiscard(registerPreviewHighlights()).pipe(
  Layer.provide(PreviewHighlightToolkitHandlersLive),
);

export const PreviewToolkitRegistrationLive = Layer.mergeAll(
  PreviewStandardToolkitRegistrationLive,
  PreviewSnapshotRegistrationLive,
  PreviewHighlightRegistrationLive,
);

export const AppControlToolkitRegistrationLive = McpServer.toolkit(AppControlToolkit).pipe(
  Layer.provide(AppControlToolkitHandlersLive),
  Layer.provide(AppControlPolicy.layer),
  Layer.provide(AppControlAudit.layer),
  Layer.provide(
    AppControlServerExecutor.layer.pipe(
      Layer.provide(AppControlTerminalCommandRunner.layer),
      Layer.provide(ProcessRunner.layer),
    ),
  ),
);

const makeMcpTransportLive = (
  path: "/mcp" | "/mcp/app-control",
  requiredCapability: McpInvocationContext.McpCapability,
) =>
  McpServer.layerHttp({
    name: "T4 Code",
    version: packageJson.version,
    path,
    protocols: [McpProtocol.v2025_06_18],
  }).pipe(Layer.provide(makeMcpAuthMiddlewareLive(requiredCapability)));

const FullMcpServerLive = Layer.mergeAll(
  PreviewToolkitRegistrationLive,
  AppControlToolkitRegistrationLive,
).pipe(Layer.provideMerge(makeMcpTransportLive("/mcp", "preview")), Layer.fresh);

const AppControlMcpServerLive = AppControlToolkitRegistrationLive.pipe(
  Layer.provideMerge(makeMcpTransportLive("/mcp/app-control", "app-control")),
  Layer.fresh,
);

export const layer = Layer.merge(FullMcpServerLive, AppControlMcpServerLive);
