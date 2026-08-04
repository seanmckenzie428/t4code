import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AppCommandDescriptor,
  AppCommandResult,
  AppControlServerInvocation,
  AppControlSnapshot,
} from "./appControl.ts";

const decodeServerInvocation = Schema.decodeUnknownEffect(AppControlServerInvocation);

it.effect("decodes command descriptors and legacy summary defaults", () =>
  Effect.gen(function* () {
    const descriptor = yield* Schema.decodeUnknownEffect(AppCommandDescriptor)({
      id: "thread.rename",
      version: 1,
      owner: "server",
      title: "Rename thread",
      description: "Changes a thread title.",
      risk: "mutate",
      requiredGrant: "thread:write",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    assert.strictEqual(descriptor.id, "thread.rename");

    const snapshot = yield* Schema.decodeUnknownEffect(AppControlSnapshot)({
      sequence: 1,
      environmentId: "environment-1",
      focusedClient: null,
      projects: [{ id: "project-1", title: "Project" }],
      threads: [{ id: "thread-1", projectId: "project-1", title: "Thread" }],
      commands: [descriptor],
    });
    assert.strictEqual(snapshot.projects[0]?.kind, "workspace");
    assert.strictEqual(snapshot.threads[0]?.kind, "project");
    assert.deepStrictEqual(snapshot.views, []);
  }),
);

it.effect("decodes bounded generated-view discovery metadata", () =>
  Effect.gen(function* () {
    const snapshot = yield* Schema.decodeUnknownEffect(AppControlSnapshot)({
      sequence: 1,
      environmentId: "environment-1",
      focusedClient: null,
      projects: [],
      threads: [],
      views: [
        {
          id: "cockpit",
          title: "Project Cockpit",
          kind: "native",
          revision: 4,
          scope: { kind: "thread", threadId: "thread-1" },
        },
      ],
      commands: [],
    });
    assert.strictEqual(snapshot.views[0]?.id, "cockpit");
    assert.strictEqual(snapshot.views[0]?.title, "Project Cockpit");
    assert.strictEqual(snapshot.views[0]?.kind, "native");
    assert.strictEqual(snapshot.views[0]?.revision, 4);
    assert.strictEqual(snapshot.views[0]?.scope.kind, "thread");
  }),
);

it.effect("decodes authenticated server semantic invocations", () =>
  Effect.gen(function* () {
    const request = yield* decodeServerInvocation({
      principal: { kind: "thread-agent", projectId: "project-1", threadId: "thread-1" },
      invocation: {
        actionId: "action-1",
        commandId: "terminal.command.run",
        args: { command: "lotus tableplus dev" },
      },
    });
    assert.strictEqual(request.invocation.commandId, "terminal.command.run");
  }),
);

it.effect("requires typed command result status shapes", () =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknownEffect(AppCommandResult)({
      status: "completed",
      receipt: {
        receiptId: "receipt-1",
        actionId: "action-1",
        commandId: "thread.rename",
        completedAt: "2026-01-01T00:00:00.000Z",
      },
      result: { title: "New title" },
    });
    assert.strictEqual(result.status, "completed");
    if (result.status === "completed") assert.strictEqual(result.receipt.idempotentReplay, false);
  }),
);

it.effect("rejects forbidden risk typos", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Schema.decodeUnknownEffect(AppCommandDescriptor)({
        id: "thread.rename",
        version: 1,
        owner: "server",
        title: "Rename thread",
        description: "Changes a thread title.",
        risk: "safe-ish",
        requiredGrant: null,
        inputSchema: {},
        outputSchema: {},
      }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);
