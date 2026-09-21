import { expect, it } from "@effect/vitest";
import {
  AppControlUnavailableError,
  EnvironmentId,
  McpCapabilityUnavailableError,
  PreviewAutomationUnavailableError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "./McpInvocationContext.ts";

it.effect("reports the scoped credential context when preview capability is unavailable", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(),
    grants: new Set<string>(),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("preview").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(PreviewAutomationUnavailableError);
    expect(error).toMatchObject({
      capability: "preview",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
    expect(error.message).toBe("MCP credential does not grant the preview capability.");
  });
});

it.effect("requires both an app-control capability and typed principal", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["app-control"]),
    grants: new Set<string>(),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireAppControlScope().pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );
    expect(error).toBeInstanceOf(AppControlUnavailableError);
    expect(error.message).toBe("MCP credential does not grant the app-control capability.");
  });
});

it.effect("reports other missing capabilities with the neutral error", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["preview"]),
    grants: new Set<string>(),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("pull-requests").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(McpCapabilityUnavailableError);
    expect(error).toMatchObject({ capability: "pull-requests", threadId: invocation.threadId });

    const scope = yield* McpInvocationContext.requireMcpCapability("preview").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
    );
    expect(scope).toBe(invocation);
  });
});

it.effect("does not let non-browser MCP credentials gain app control", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-1");
    const principal = {
      kind: "thread-agent" as const,
      threadId,
      projectId: ProjectId.make("project-1"),
    };
    const base = {
      environmentId: EnvironmentId.make("environment-1"),
      threadId,
      providerSessionId: "provider-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
      grants: new Set(["thread:mutate", "view:mutate"]),
      issuedAt: 1,
    };
    for (const capabilities of [
      new Set<McpInvocationContext.McpCapability>(["pull-requests"]),
      new Set<McpInvocationContext.McpCapability>(["pull-requests", "device"]),
    ]) {
      const error = yield* McpInvocationContext.requireAppControlScope().pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...base,
          principal,
          capabilities,
        }),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(AppControlUnavailableError);
    }

    const allowed = {
      ...base,
      principal,
      capabilities: new Set<McpInvocationContext.McpCapability>(["pull-requests", "app-control"]),
    };
    const scope = yield* McpInvocationContext.requireAppControlScope().pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, allowed),
    );
    expect(scope.principal).toEqual(principal);
    expect(scope.capabilities.has("preview")).toBe(false);
  }),
);
