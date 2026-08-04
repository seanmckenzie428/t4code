import { expect, it } from "@effect/vitest";
import { getAppCommandCatalogEntry } from "@t3tools/client-runtime/app-control";
import {
  AppActionId,
  AppCommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { make, payloadFor, type AppControlAuditStatus } from "./AppControlAudit.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const threadScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  principal: {
    kind: "thread-agent" as const,
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
  },
  capabilities: new Set(["app-control"] as const),
  grants: new Set(["thread:mutate", "credential:do-not-persist"]),
  issuedAt: 1,
};

const invocation = {
  actionId: AppActionId.make("action-1"),
  commandId: AppCommandId.make("thread.rename"),
  args: {
    threadId: "thread-1",
    title: "agent prose must not become audit metadata",
    command: "echo secret",
    credential: "super-secret",
    answers: { approval: true },
  },
};

const descriptor = getAppCommandCatalogEntry("thread.rename")?.descriptor;

const makeAudit = (commands: OrchestrationCommand[], validThread = true, failPersistence = false) =>
  make.pipe(
    Effect.provideService(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        dispatch: (command) => {
          if (failPersistence) return Effect.die(new Error("audit store unavailable"));
          return Effect.sync(() => {
            commands.push(command);
            return { sequence: commands.length };
          });
        },
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
    ),
    Effect.provideService(ProjectionSnapshotQuery, {
      getThreadShellById: () =>
        Effect.succeed(validThread ? Option.some({} as never) : Option.none()),
    } as unknown as ProjectionSnapshotQuery["Service"]),
  );

it.effect("persists each app-control status as a sanitized ordered thread activity", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const audit = yield* makeAudit(commands);
    const statuses = ["requested", "completed", "failed", "declined"] as const;

    for (const status of statuses) {
      yield* audit.record({ scope: threadScope, invocation, descriptor, status });
    }

    expect(commands).toHaveLength(4);
    expect(commands.map((command) => command.commandId)).toEqual(
      statuses.map((status) => `app-control-audit:provider-session-1:action-1:${status}`),
    );
    expect(commands.map((command) => command.type)).toEqual(
      statuses.map(() => "thread.activity.append"),
    );
    expect(
      commands.map((command) =>
        command.type === "thread.activity.append" ? command.activity.kind : undefined,
      ),
    ).toEqual(statuses.map((status) => `app-control.${status}`));
    expect(
      commands.map((command) =>
        command.type === "thread.activity.append" ? command.threadId : undefined,
      ),
    ).toEqual(statuses.map(() => "thread-1"));

    const payloads = commands.map((command) =>
      command.type === "thread.activity.append" ? command.activity.payload : undefined,
    );
    expect(payloads).toEqual(
      statuses.map((status) => ({
        actionId: "action-1",
        commandId: "thread.rename",
        principalKind: "thread-agent",
        risk: "mutate",
        status,
        projectId: "project-1",
        threadId: "thread-1",
      })),
    );
    expect(
      commands.map((command) =>
        command.type === "thread.activity.append" ? command.activity.summary : undefined,
      ),
    ).toEqual([
      "Rename thread requested",
      "Rename thread completed",
      "Rename thread failed",
      "Rename thread declined",
    ]);
  }),
);

it.effect("attaches global-assistant audit to its assistant thread", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const audit = yield* makeAudit(commands);
    yield* audit.record({
      scope: {
        ...threadScope,
        threadId: ThreadId.make("transport-thread-do-not-use"),
        principal: {
          kind: "global-assistant",
          assistantThreadId: ThreadId.make("assistant-thread-1"),
        },
      },
      invocation,
      descriptor,
      status: "requested",
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "thread.activity.append",
      threadId: "assistant-thread-1",
      activity: {
        payload: {
          principalKind: "global-assistant",
          assistantThreadId: "assistant-thread-1",
        },
      },
    });
  }),
);

it.effect("keeps structured audit logging but skips persistence for a missing thread", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const audit = yield* makeAudit(commands, false);
    yield* audit.record({
      scope: threadScope,
      invocation,
      descriptor,
      status: "failed",
    });
    expect(commands).toEqual([]);
  }),
);

it.effect("does not fail the caller when durable audit persistence fails", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const audit = yield* makeAudit(commands, true, true);
    yield* audit.record({
      scope: threadScope,
      invocation,
      descriptor,
      status: "completed",
    });
    expect(commands).toEqual([]);
  }),
);

it("builds an allowlisted payload without invocation arguments or session credentials", () => {
  const statuses: ReadonlyArray<AppControlAuditStatus> = [
    "requested",
    "completed",
    "failed",
    "declined",
  ];
  for (const status of statuses) {
    expect(
      Object.keys(payloadFor({ scope: threadScope, invocation, descriptor, status })).sort(),
    ).toEqual([
      "actionId",
      "commandId",
      "principalKind",
      "projectId",
      "risk",
      "status",
      "threadId",
    ]);
  }
});
