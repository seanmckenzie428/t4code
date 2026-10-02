import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as ProjectionMaintenance from "../ProjectionMaintenance.ts";
import * as LegacyV1ThreadImporter from "./LegacyV1ThreadImporter.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const sink = EventSink.layer.pipe(Layer.provideMerge(stores));
const testLayer = Layer.mergeAll(
  LegacyV1ThreadImporter.layer.pipe(Layer.provideMerge(sink)),
  ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
);

it.effect(
  "retains historical Review checkpoints and turn identities across lazy import and replay",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const threadId = ThreadId.make("pilot:history");
      const now = "2026-10-01T00:00:00.000Z";
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at)
    VALUES ('history-project', 'History', '/repo', NULL, '[]', ${now}, ${now})`;
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
    VALUES (${threadId}, 'history-project', 'Review history', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', ${now}, ${now})`;
      yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, completed_at, checkpoint_files_json)
    VALUES (${threadId}, 'legacy-failed-turn', 'failed-message', 'error', ${now}, ${now}, '[]')`;
      for (const count of [1, 2]) {
        const time = `2026-10-01T00:00:0${count}.000Z`;
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
      VALUES (${`message-${count}`}, ${threadId}, NULL, 'user', ${`Request ${count}`}, 0, ${time}, ${time})`;
        yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json)
      VALUES (${threadId}, ${`legacy-turn-${count}`}, ${`message-${count}`}, 'completed', ${time}, ${time}, ${time}, ${count}, ${checkpointRefForThreadTurn(threadId, count)}, 'ready', '[{"path":"src/app.ts","kind":"modified","additions":2,"deletions":1}]')`;
      }
      yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
      VALUES ('reasoning-1', ${threadId}, 'legacy-turn-1', 'reasoning', 'Retain the original checkpoint before changing code.', 0, '2026-10-01T00:00:01.500Z', '2026-10-01T00:00:01.500Z')`;
      yield* importer.reconcileShells;
      yield* importer.ensureTranscript(threadId);
      const projection = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(
        projection.runs.map((run) => run.id),
        ["legacy-failed-turn", "legacy-turn-1", "legacy-turn-2"].map((id) => RunId.make(id)),
      );
      assert.deepEqual(
        projection.runs.map((run) => [run.ordinal, run.status]),
        [
          [1, "failed"],
          [2, "completed"],
          [3, "completed"],
        ],
      );
      assert.deepEqual(
        projection.messages.map((message) => message.runId),
        ["legacy-turn-1", "legacy-turn-2"].map((id) => RunId.make(id)),
      );
      assert.deepEqual(
        projection.checkpoints.map((checkpoint) => checkpoint.ref),
        [0, 1, 2].map((count) => checkpointRefForThreadTurn(threadId, count)),
      );
      assert.deepEqual(
        projection.checkpoints.map((checkpoint) => checkpoint.appRunOrdinal),
        [null, 1, 2],
      );
      assert.deepEqual(projection.checkpoints[1]?.files, [
        { path: "src/app.ts", kind: "modified", additions: 2, deletions: 1 },
      ]);
      assert.equal(projection.checkpointScopes[0]?.cwd, "/repo");
      assert.equal(projection.runs[2]?.checkpointId, projection.checkpoints[2]?.id);
      assert.deepEqual(yield* importer.ensureTranscript(threadId), {
        importedThreadCount: 0,
        importedMessageCount: 0,
      });
      yield* maintenance.rebuild;
      const replayed = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(replayed.visibleTurnItems, projection.visibleTurnItems);
      assert.equal(replayed.messages.length, 2);
      const reasoning = replayed.visibleTurnItems[1]?.item;
      assert.equal(reasoning?.type, "reasoning");
      if (reasoning?.type !== "reasoning") throw new Error("Missing reasoning item");
      assert.equal(reasoning.text, "Retain the original checkpoint before changing code.");
      assert.equal(reasoning.streaming, false);
      assert.deepEqual(replayed.runs, projection.runs);
      assert.deepEqual(replayed.checkpoints, projection.checkpoints);
      assert.deepEqual(
        replayed.visibleTurnItems.map((row) => row.item.runId),
        ["legacy-turn-1", "legacy-turn-1", "legacy-turn-2"].map((id) => RunId.make(id)),
      );
    }).pipe(Effect.provide(testLayer)),
);

for (const [driver, instanceId, rewound] of [
  ["codex", "codex", false],
  ["claudeAgent", "claudeAgent", false],
  ["claudeAgent", "claude-personal", false],
  ["claudeAgent", "claude-personal", true],
] as const) {
  it.effect(
    `retains ${instanceId} native turn boundaries for historical rewind (prior fork ${rewound})`,
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const threadId = ThreadId.make(`pilot:native-history:${instanceId}`);
        const now = "2026-10-01T00:00:00.000Z";
        const nativeId = "00000000-0000-4000-8000-000000000001";
        const boundaries = rewound
          ? ["fork-user-1", "fork-user-2"]
          : ["legacy-turn-1", "legacy-turn-2"];
        const cursor = encodeJson(
          driver === "codex"
            ? { threadId: nativeId }
            : {
                resume: nativeId,
                resumeSessionAt: "assistant-cursor-2",
                turnCount: 2,
                turnStartMessageIds: boundaries,
              },
        );
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('native-project', 'History', '/repo', '[]', ${now}, ${now})`;
        yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, created_at, updated_at)
        VALUES (${threadId}, 'native-project', 'Native history', ${encodeJson({ instanceId, model: "model" })}, ${now}, ${now})`;
        yield* sql`INSERT INTO provider_session_runtime (thread_id, provider_name, provider_instance_id, adapter_key, runtime_mode, status, last_seen_at, resume_cursor_json)
        VALUES (${threadId}, ${driver}, ${instanceId === driver ? null : instanceId}, ${driver}, 'full-access', 'stopped', ${now}, ${cursor})`;
        yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, completed_at, checkpoint_files_json)
        VALUES (${threadId}, 'never-started', 'failed-message', 'error', ${now}, ${now}, '[]')`;
        for (const ordinal of [1, 2]) {
          const time = `2026-10-01T00:00:0${ordinal}.000Z`;
          yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, started_at, completed_at, checkpoint_files_json)
          VALUES (${threadId}, ${`legacy-turn-${ordinal}`}, ${`message-${ordinal}`}, 'completed', ${time}, ${time}, ${time}, '[]')`;
          yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
          VALUES (${`matching-session-${ordinal}`}, 'thread', ${threadId}, ${ordinal}, 'thread.session-set', ${time}, 'provider', ${encodeJson({ session: { activeTurnId: `legacy-turn-${ordinal}`, providerName: driver, providerInstanceId: instanceId } })}, '{}')`;
        }
        if (rewound) {
          yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
          VALUES ('old-rewind', 'thread', ${threadId}, 3, 'thread.reverted', ${now}, 'server', ${encodeJson({ threadId, turnCount: 2 })}, '{}')`;
        } else {
          yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, started_at, completed_at, checkpoint_files_json)
        VALUES (${threadId}, 'foreign-provider-turn', 'foreign-message', 'completed', '2026-10-01T00:00:03.000Z', '2026-10-01T00:00:03.000Z', '2026-10-01T00:00:03.000Z', '[]')`;
          yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
        VALUES ('foreign-session', 'thread', ${threadId}, 3, 'thread.session-set', ${now}, 'provider', ${encodeJson({ session: { activeTurnId: "foreign-provider-turn", providerName: driver === "codex" ? "claudeAgent" : "codex", providerInstanceId: "foreign-instance" } })}, '{}')`;
        }
        yield* importer.reconcileShells;
        yield* importer.ensureTranscript(threadId);
        const result = yield* projections.getThreadProjection(threadId);
        assert.equal(result.providerTurns.length, 2);
        assert.equal(result.providerThreads[0]?.driver, ProviderDriverKind.make(driver));
        assert.equal(
          result.providerThreads[0]?.providerInstanceId,
          ProviderInstanceId.make(instanceId),
        );
        assert.equal(result.attempts.length, 2);
        assert.deepEqual(
          result.providerTurns.map((turn) => turn.ordinal),
          [1, 2],
        );
        assert.deepEqual(
          result.providerTurns.map((turn) => turn.nativeTurnRef?.nativeId ?? null),
          driver === "codex" ? ["legacy-turn-1", "legacy-turn-2"] : [null, "assistant-cursor-2"],
        );
        assert.equal(result.runs[0]?.activeAttemptId, null);
        if (!rewound) {
          assert.equal(result.runs[3]?.activeAttemptId, null);
          assert.equal(result.runs[3]?.providerThreadId, null);
        }
        assert.equal(result.attempts[0]?.nativeThreadId, nativeId);
        assert.equal(result.attempts[0]?.providerTurnId, result.providerTurns[0]?.id);
        assert.equal(result.runs[1]?.activeAttemptId, result.attempts[0]?.id);
        if (driver === "claudeAgent") {
          assert.deepEqual(
            result.providerTurns.map((turn) => turn.legacyClaudeUserMessageId),
            boundaries,
          );
          assert.deepEqual(
            result.providerThreads[0]?.nativeMetadata?.legacyClaudeTurnStartMessageIds,
            boundaries,
          );
          assert.equal(
            result.providerThreads[0]?.nativeConversationHeadRef?.nativeId,
            "assistant-cursor-2",
          );
        }
        yield* importer.ensureTranscript(threadId);
        assert.equal((yield* projections.getThreadProjection(threadId)).providerTurns.length, 2);
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        yield* maintenance.rebuild;
        const replayed = yield* projections.getThreadProjection(threadId);
        assert.deepEqual(replayed.providerTurns, result.providerTurns);
        assert.deepEqual(replayed.attempts, result.attempts);
      }).pipe(Effect.provide(testLayer)),
  );
}
