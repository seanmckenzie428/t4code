import { getAppCommandCatalogEntry } from "@t3tools/client-runtime/app-control";
import {
  ProviderInstanceId,
  type AppCommandResult,
  type AppControlError,
  type AppControlPrincipal,
  type AppCommandInvocation,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";

import type { AppControlPolicy } from "./AppControlPolicy.ts";

export interface AppControlClientInvocationInput {
  readonly environmentId: EnvironmentId;
  readonly providerSessionId: string;
  readonly principal: AppControlPrincipal;
  readonly invocation: AppCommandInvocation;
}

const failed = (invocation: AppCommandInvocation, error: AppControlError): AppCommandResult => ({
  status: "failed",
  actionId: invocation.actionId,
  error,
});

/**
 * Converts an authenticated client click into the same policy input used by
 * MCP. Client-owned commands are deliberately rejected to prevent an RPC loop;
 * those continue to execute in the focused web/desktop command host.
 */
export const invokeServerCommandFromClient = Effect.fn(
  "AppControlClientInvoker.invokeServerCommandFromClient",
)(function* (policy: AppControlPolicy["Service"], input: AppControlClientInvocationInput) {
  const descriptor = getAppCommandCatalogEntry(input.invocation.commandId)?.descriptor;
  if (
    descriptor === undefined ||
    descriptor.owner !== "server" ||
    descriptor.risk === "forbidden"
  ) {
    return failed(input.invocation, {
      code: "unsupported",
      message: "This semantic command is not server-owned.",
      retryable: false,
    });
  }

  const threadId =
    input.principal.kind === "thread-agent"
      ? input.principal.threadId
      : input.principal.assistantThreadId;
  const grants = new Set<string>();
  if (descriptor.requiredGrant !== null) grants.add(descriptor.requiredGrant);
  const issuedAt = yield* Clock.currentTimeMillis;

  return yield* policy.invoke({
    scope: {
      environmentId: input.environmentId,
      threadId,
      providerSessionId: input.providerSessionId,
      providerInstanceId: ProviderInstanceId.make("t3-authenticated-client"),
      principal: input.principal,
      capabilities: new Set(["app-control"]),
      grants,
      issuedAt,
    },
    invocation: input.invocation,
  });
});
