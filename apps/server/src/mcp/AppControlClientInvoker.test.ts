import { expect, it } from "@effect/vitest";
import { AppActionId, AppCommandId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { AppControlPolicy } from "./AppControlPolicy.ts";
import { invokeServerCommandFromClient } from "./AppControlClientInvoker.ts";

const principal = {
  kind: "thread-agent" as const,
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
};

it.effect("routes a server command through policy with authenticated thread scope", () =>
  Effect.gen(function* () {
    let received: Parameters<AppControlPolicy["Service"]["invoke"]>[0] | undefined;
    const policy = AppControlPolicy.of({
      invoke: (input) =>
        Effect.sync(() => {
          received = input;
          return { status: "declined", actionId: input.invocation.actionId } as const;
        }),
    });
    const result = yield* invokeServerCommandFromClient(policy, {
      environmentId: EnvironmentId.make("environment-1"),
      providerSessionId: "client-session-1",
      principal,
      invocation: {
        actionId: AppActionId.make("action-1"),
        commandId: AppCommandId.make("terminal.command.run"),
        args: { command: "lotus tableplus dev" },
      },
    });

    expect(result).toEqual({ status: "declined", actionId: "action-1" });
    expect(received?.scope).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
      providerSessionId: "client-session-1",
      principal,
    });
    expect(received?.scope.capabilities.has("app-control")).toBe(true);
  }),
);

it.effect("rejects client-owned and forbidden command IDs before policy", () =>
  Effect.gen(function* () {
    let calls = 0;
    const policy = AppControlPolicy.of({
      invoke: () => Effect.sync(() => (calls += 1) as never),
    });
    const result = yield* invokeServerCommandFromClient(policy, {
      environmentId: EnvironmentId.make("environment-1"),
      providerSessionId: "client-session-1",
      principal,
      invocation: {
        actionId: AppActionId.make("action-2"),
        commandId: AppCommandId.make("approval.respond"),
        args: {},
      },
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "unsupported" } });
    expect(calls).toBe(0);
  }),
);
