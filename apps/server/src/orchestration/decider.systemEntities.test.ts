import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const projectId = ProjectId.make("system-project");
const threadId = ThreadId.make("assistant-thread");
const now = "2026-08-01T00:00:00.000Z";

const seedSystemEntities = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("system-project-created"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("create-system-project"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      projectId,
      kind: "system",
      systemRole: "global-assistant",
      title: "T3 Assistant",
      workspaceRoot: "/isolated/assistant",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
  return yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("assistant-thread-created"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: now,
    commandId: CommandId.make("create-assistant-thread"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      projectId,
      kind: "assistant",
      title: "T3 Assistant",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
      runtimeMode: "approval-required",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

it.layer(NodeServices.layer)("system entity invariants", (it) => {
  it.effect("rejects ordinary project mutation and deletion", () =>
    Effect.gen(function* () {
      const readModel = yield* seedSystemEntities;
      for (const command of [
        {
          type: "project.meta.update",
          commandId: CommandId.make("rename-system-project"),
          projectId,
          title: "Renamed",
        },
        {
          type: "project.delete",
          commandId: CommandId.make("delete-system-project"),
          projectId,
          force: true,
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>) {
        const error = yield* Effect.flip(decideOrchestrationCommand({ command, readModel }));
        expect(error.message).toContain("System project");
      }
    }),
  );

  it.effect("rejects ordinary assistant-thread mutation and deletion", () =>
    Effect.gen(function* () {
      const readModel = yield* seedSystemEntities;
      for (const command of [
        {
          type: "thread.meta.update",
          commandId: CommandId.make("rename-assistant-thread"),
          threadId,
          title: "Renamed",
        },
        {
          type: "thread.delete",
          commandId: CommandId.make("delete-assistant-thread"),
          threadId,
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>) {
        const error = yield* Effect.flip(decideOrchestrationCommand({ command, readModel }));
        expect(error.message).toContain("Assistant thread");
      }
    }),
  );
});
