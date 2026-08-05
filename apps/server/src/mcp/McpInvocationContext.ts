import {
  type AppControlPrincipal,
  AppControlUnavailableError,
  type EnvironmentId,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability = "preview" | "app-control";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly principal?: AppControlPrincipal;
  readonly capabilities: ReadonlySet<McpCapability>;
  /** Grants captured when this provider session was issued. Never mutable by MCP tools. */
  readonly grants: ReadonlySet<string>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

export const requireMcpCapability = Effect.fn("mcp.requireCapability")(function* (
  capability: "preview",
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has(capability)) {
    return yield* new PreviewAutomationUnavailableError({
      capability,
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});

export const requireAppControlScope = Effect.fn("mcp.requireAppControlScope")(function* () {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("app-control") || invocation.principal === undefined) {
    return yield* new AppControlUnavailableError({
      capability: "app-control",
      environmentId: invocation.environmentId,
      ...(invocation.principal === undefined ? {} : { principal: invocation.principal }),
      reason: "MCP credential does not grant the app-control capability.",
    });
  }
  return { ...invocation, principal: invocation.principal };
});
