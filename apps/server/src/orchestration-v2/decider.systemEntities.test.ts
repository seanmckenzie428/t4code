import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { planProjectCommand, type ProjectCommand } from "./ProjectCommands.ts";
import type { ProjectRow } from "./ProjectStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const projectId = ProjectId.make("project");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const now = DateTime.makeUnsafe("2026-10-02T00:00:00Z");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Retired threads must never open a provider"),
} as ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const testLayer = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "retired-system-entities" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

it("rejects ordinary mutation/deletion and provisioning of retired system projects", () => {
  const project: ProjectRow = {
    projectId,
    kind: "system",
    systemRole: "quick-chat",
    title: "Quick Chat",
    workspaceRoot: "/retired",
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    customActions: [],
    createdAt: DateTime.formatIso(now),
    updatedAt: DateTime.formatIso(now),
    deletedAt: null,
  };
  const commands: ReadonlyArray<ProjectCommand> = [
    {
      type: "project.meta.update",
      commandId: CommandId.make("rename"),
      projectId,
      title: "Renamed",
    },
    { type: "project.delete", commandId: CommandId.make("delete"), projectId },
    ...(["quick-chat", "global-assistant"] as const).map((systemRole) => ({
      type: "project.create" as const,
      commandId: CommandId.make(`create-${systemRole}`),
      projectId,
      kind: "system" as const,
      systemRole,
      title: "Retired",
      workspaceRoot: "/retired",
    })),
  ];
  for (const command of commands) {
    const result = planProjectCommand({
      command,
      state: {
        project: command.type === "project.create" ? undefined : project,
        workspaceOwner: undefined,
      },
      eventId: EventId.make(command.commandId),
      now,
    });
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.equal(result.failure._tag, "ProjectCommandInvariantError");
  }
});

for (const kind of ["assistant", "quick"] as const) {
  it.effect(`rejects creation, mutation, deletion and messages for retired ${kind} threads`, () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make(`retired-${kind}`);
      const create = {
        type: "thread.create" as const,
        commandId: CommandId.make(`create-${kind}`),
        threadId,
        projectId,
        title: "Retired",
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        createdBy: "user" as const,
        creationSource: "web" as const,
      };
      const creation = yield* Effect.flip(orchestrator.dispatch({ ...create, kind }));
      assert.equal(creation._tag, "OrchestratorDispatchError");
      yield* orchestrator.dispatch({ ...create, commandId: CommandId.make(`seed-${kind}`) });
      const thread = yield* projections.getThread(threadId);
      yield* projections.apply({
        id: EventId.make(`historical-${kind}`),
        type: "thread.metadata-updated",
        threadId,
        occurredAt: now,
        payload: { ...thread, kind },
      });
      const ordinaryThreadId = ThreadId.make(`ordinary-${kind}`);
      yield* orchestrator.dispatch({
        ...create,
        commandId: CommandId.make(`ordinary-${kind}`),
        threadId: ordinaryThreadId,
      });
      const commands: ReadonlyArray<OrchestrationV2Command> = [
        {
          type: "thread.metadata.update",
          commandId: CommandId.make(`rename-${kind}`),
          threadId,
          title: "Changed",
        },
        { type: "thread.delete", commandId: CommandId.make(`delete-${kind}`), threadId },
        {
          type: "thread.fork",
          commandId: CommandId.make(`fork-${kind}`),
          sourceThreadId: threadId,
          targetThreadId: ThreadId.make(`fork-${kind}`),
          sourcePoint: { type: "latest_stable" },
          createdBy: "user",
          creationSource: "web",
        },
        {
          type: "thread.merge_back",
          commandId: CommandId.make(`merge-${kind}`),
          sourceThreadId: threadId,
          targetThreadId: ordinaryThreadId,
          sourcePoint: { type: "latest_stable" },
          createdBy: "user",
          creationSource: "web",
        },
        {
          type: "message.dispatch",
          commandId: CommandId.make(`send-${kind}`),
          threadId,
          messageId: MessageId.make(`message-${kind}`),
          text: "Continue",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          dispatchMode: { type: "start_immediately" },
        },
      ];
      for (const command of commands) {
        const error = yield* Effect.flip(orchestrator.dispatch(command));
        assert.equal(error._tag, "OrchestratorDispatchError");
        if (error._tag === "OrchestratorDispatchError") {
          assert.equal(
            error.cause,
            "Quick Chat and assistant threads are retired and cannot be changed.",
          );
        }
      }
      for (const targetThreadId of [threadId, ordinaryThreadId]) {
        const error = yield* Effect.flip(
          orchestrator.dispatch({
            type: "thread.fork",
            commandId: CommandId.make(`existing-target-${targetThreadId}`),
            sourceThreadId: ordinaryThreadId,
            targetThreadId,
            sourcePoint: { type: "latest_stable" },
            createdBy: "user",
            creationSource: "web",
          }),
        );
        assert.equal(error._tag, "OrchestratorDispatchError");
        if (error._tag === "OrchestratorDispatchError") {
          assert.equal(error.cause, `Cannot fork into existing thread ${targetThreadId}.`);
        }
      }
      assert.isNull(yield* projections.getThreadShell(threadId));
      const snapshot = yield* projections.getShellSnapshot();
      assert.isFalse(
        [...snapshot.threads, ...snapshot.archivedThreads].some((thread) => thread.id === threadId),
      );
      const preserved = yield* projections.getThread(threadId);
      assert.equal(preserved.title, "Retired");
      assert.isNull(preserved.deletedAt);
      assert.equal(yield* projections.getMessageCount(threadId), 0);
    }).pipe(Effect.provide(testLayer)),
  );
}

it.effect("rejects an ordinary thread created inside a retired system project", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, kind, system_role, created_at, updated_at)
      VALUES (${projectId}, 'Retired', '/retired', '[]', 'system', 'quick-chat', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`;
    const error = yield* Effect.flip(
      orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("system-project-thread"),
        threadId: ThreadId.make("system-project-thread"),
        projectId,
        title: "Ordinary thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      }),
    );
    assert.equal(error._tag, "OrchestratorDispatchError");
    assert.deepEqual((yield* projections.getShellSnapshot()).threads, []);
  }).pipe(Effect.provide(testLayer)),
);
