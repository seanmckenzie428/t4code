import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
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
const quickProjectId = ProjectId.make("quick-system-project");
const quickThreadId = ThreadId.make("quick-thread");
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
      title: "Legacy Assistant",
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
      title: "Legacy Assistant",
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

const seedQuickProject = projectEvent(createEmptyReadModel(now), {
  sequence: 1,
  eventId: EventId.make("quick-system-project-created"),
  aggregateKind: "project",
  aggregateId: quickProjectId,
  type: "project.created",
  occurredAt: now,
  commandId: CommandId.make("create-quick-system-project"),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    projectId: quickProjectId,
    kind: "system",
    systemRole: "quick-chat",
    title: "Quick Chat",
    workspaceRoot: "/isolated/quick-chat",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
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

  for (const kind of ["assistant", "quick"] as const) {
    it.effect(`rejects turns on historical ${kind} threads`, () =>
      Effect.gen(function* () {
        const readModel = yield* seedSystemEntities;
        const historical = {
          ...readModel,
          threads: readModel.threads.map((thread) => ({ ...thread, kind })),
        };
        const result = yield* decideOrchestrationCommand({
          readModel: historical,
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("start-assistant-turn"),
            threadId,
            message: {
              messageId: MessageId.make("assistant-user-message"),
              role: "user",
              text: "Inspect the environment",
              attachments: [],
            },
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6",
            },
            runtimeMode: "approval-required",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: now,
          },
        }).pipe(Effect.flip);

        expect(result.message).toContain("no longer supported");
      }),
    );
  }

  it.effect("rejects creating retired quick threads", () =>
    Effect.gen(function* () {
      const readModel = yield* seedQuickProject;
      const command = {
        type: "thread.create",
        commandId: CommandId.make("create-quick-thread"),
        threadId: quickThreadId,
        projectId: quickProjectId,
        kind: "quick",
        title: "Quick Chat",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
      } as const;

      const error = yield* decideOrchestrationCommand({ command, readModel }).pipe(Effect.flip);
      expect(error.message).toContain("no longer supported");
    }),
  );
  for (const systemRole of ["global-assistant", "quick-chat"] as const) {
    it.effect(`rejects provisioning retired ${systemRole} projects`, () =>
      Effect.gen(function* () {
        const result = yield* decideOrchestrationCommand({
          readModel: createEmptyReadModel(now),
          command: {
            type: "project.create",
            commandId: CommandId.make(`create-${systemRole}`),
            projectId,
            kind: "system",
            systemRole,
            title: "Retired",
            workspaceRoot: "/retired",
            createdAt: now,
          },
        }).pipe(Effect.flip);
        expect(result.message).toContain("no longer supported");
      }),
    );
  }
});
