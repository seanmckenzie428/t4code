import { assert, it } from "@effect/vitest";
import { EventId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as ProjectionMaintenance from "../ProjectionMaintenance.ts";
import * as LegacyV1ThreadImporter from "./LegacyV1ThreadImporter.ts";
import { importLegacyWorkLog } from "./PilotLegacyWorkLog.ts";

const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

it.effect("keeps reused agent and task history in its original run after rollback", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const threadId = ThreadId.make("pilot:reused-agent");
    const now = "2026-10-01T00:00:00.000Z";
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('reused-agent-project', 'History', '/repo', '[]', ${now}, ${now})`;
    yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, created_at, updated_at)
      VALUES (${threadId}, 'reused-agent-project', 'History', '{"instanceId":"codex","model":"gpt-6"}', ${now}, ${now})`;
    for (const ordinal of [1, 2]) {
      const at = `2026-10-01T00:00:0${ordinal}.000Z`;
      const turnId = `turn-${ordinal}`;
      yield* sql`INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, started_at, completed_at, checkpoint_files_json)
        VALUES (${threadId}, ${turnId}, 'completed', ${at}, ${at}, ${at}, '[]')`;
      for (const kind of ["tool.completed", "task.completed"]) {
        const id = `${kind}:${ordinal}`;
        const payload =
          kind === "tool.completed"
            ? { agentId: "shared-agent", itemId: id, data: { output: `turn ${ordinal}` } }
            : { taskId: "shared-task", output: `turn ${ordinal}` };
        yield* sql`INSERT INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence)
          VALUES (${id}, ${threadId}, ${turnId}, 'tool', ${kind}, ${id}, ${encodePayload(payload)}, ${at}, ${ordinal})`;
      }
    }
    yield* importer.reconcileShells;
    yield* importer.ensureTranscript(threadId);
    const before = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(
      before.visibleTurnItems.map((row) => row.item.runId),
      [RunId.make("turn-1"), RunId.make("turn-1"), RunId.make("turn-2"), RunId.make("turn-2")],
    );
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("rollback-second-run"),
          type: "run.updated",
          threadId,
          occurredAt: DateTime.makeUnsafe(now),
          payload: { ...before.runs[1]!, status: "rolled_back" },
        },
      ],
    });
    const after = yield* projections.getThreadProjection(threadId);
    assert.equal(after.visibleTurnItems.length, 2);
    assert.deepEqual(
      after.visibleTurnItems.map((row) => row.item.runId),
      [RunId.make("turn-1"), RunId.make("turn-1")],
    );
    assert.deepEqual(
      after.visibleTurnItems.map((row) => row.item),
      before.visibleTurnItems.slice(0, 2).map((row) => row.item),
    );
  }).pipe(Effect.provide(testLayer)),
);
const sink = EventSink.layer.pipe(Layer.provideMerge(stores));
const testLayer = Layer.mergeAll(
  LegacyV1ThreadImporter.layer.pipe(Layer.provideMerge(sink)),
  ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
);

it.effect(
  "imports interleaved tools and plans once, correcting shell previews through replayable events",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const threadId = ThreadId.make("pilot:work-log");
      const at = (second: number) => `2026-10-01T00:00:${String(second).padStart(2, "0")}.000Z`;
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('work-log-project', 'History', '/repo', '[]', ${at(0)}, ${at(9)})`;
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
    VALUES (${threadId}, 'work-log-project', 'History', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', ${at(0)}, ${at(9)})`;
      for (const [id, role, second] of [
        ["user", "user", 0],
        ["reasoning", "reasoning", 2],
        ["assistant", "assistant", 9],
      ] as const) {
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
      VALUES (${id}, ${threadId}, NULL, ${role}, ${id}, 0, ${at(second)}, ${at(second)})`;
      }
      const activity = (id: string, kind: string, second: number, payload: unknown) => sql`
    INSERT INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence)
    VALUES (${id}, ${threadId}, NULL, 'tool', ${kind}, ${id}, ${encodePayload(payload)}, ${at(second)}, ${second})`;
      yield* activity("tool-start", "tool.updated", 1, {
        itemId: "call-1",
        data: { toolName: "Bash", input: { command: "pwd" } },
        status: "running",
      });
      yield* activity("tool-done", "tool.completed", 3, {
        itemId: "call-1",
        data: { output: "/repo" },
        status: "completed",
      });
      yield* activity("todo", "turn.plan.updated", 4, {
        plan: [{ step: "Review code", status: "completed" }],
        explanation: "Inspect before changing",
      });
      yield* activity("audit", "app-control.completed", 5, {
        commandId: "review.open",
        detail: "Opened Review",
      });
      yield* activity("interrupted-tool", "tool.updated", 7, {
        itemId: "call-2",
        status: "running",
        data: { input: { file: "src/app.ts" } },
      });
      yield* sql`INSERT INTO projection_thread_proposed_plans (plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at, implemented_at)
    VALUES ('legacy-plan', ${threadId}, NULL, '# Implement safely', ${at(6)}, ${at(6)}, ${at(8)})`;
      yield* activity("agent-tool-one", "tool.completed", 8, {
        agentId: "agent-1",
        itemId: "nested-one",
        data: { output: "first trace" },
      });
      yield* activity("agent-tool-two", "tool.completed", 8, {
        agentId: "agent-1",
        itemId: "nested-two",
        data: { output: "second trace" },
      });
      yield* importer.reconcileShells;
      const preview = yield* projections.getThreadProjection(threadId);
      assert.equal(preview.visibleTurnItems.at(-1)?.item.ordinal, 3);
      yield* importer.ensureTranscript(threadId);
      const projection = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(
        projection.visibleTurnItems.map((row) => row.item.type),
        [
          "user_message",
          "dynamic_tool",
          "reasoning",
          "todo_list",
          "notification",
          "proposed_plan",
          "dynamic_tool",
          "dynamic_tool",
          "assistant_message",
        ],
      );
      assert.deepEqual(
        projection.visibleTurnItems.map((row) => row.item.ordinal),
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
      );
      const tool = projection.visibleTurnItems[1]!.item;
      assert.equal(tool.type, "dynamic_tool");
      if (tool.type === "dynamic_tool") {
        assert.equal(tool.status, "completed");
        assert.equal(tool.toolName, "Bash");
        assert.deepEqual(tool.input, { command: "pwd" });
        assert.deepEqual(tool.output, [
          {
            itemId: "call-1",
            data: { toolName: "Bash", input: { command: "pwd" } },
            status: "running",
          },
          { itemId: "call-1", data: { output: "/repo" }, status: "completed" },
        ]);
      }
      assert.equal(projection.visibleTurnItems[6]?.item.status, "interrupted");
      const agent = projection.visibleTurnItems[7]?.item;
      assert.equal(agent?.title, "Agent activity");
      assert.equal(
        agent?.type === "dynamic_tool" && Array.isArray(agent.output) ? agent.output.length : 0,
        2,
      );
      assert.equal(projection.plans.find((plan) => plan.id === "legacy-plan")?.status, "completed");
      assert.equal(projection.plans.find((plan) => plan.kind === "todo_list")?.status, "completed");
      const before = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM orchestration_events WHERE stream_id = ${threadId}`;
      yield* importLegacyWorkLog(threadId, [
        { message_id: "user", created_at: at(0), role: "user" },
        { message_id: "reasoning", created_at: at(2), role: "reasoning" },
        { message_id: "assistant", created_at: at(9), role: "assistant" },
      ]);
      assert.deepEqual(
        yield* sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM orchestration_events WHERE stream_id = ${threadId}`,
        before,
      );
      yield* maintenance.rebuild;
      const replayed = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(replayed.visibleTurnItems, projection.visibleTurnItems);
      assert.deepEqual(replayed.plans, projection.plans);
      const positions = yield* sql<{
        ordinal: number;
      }>`SELECT ordinal FROM orchestration_v2_turn_item_positions WHERE thread_id = ${threadId} ORDER BY ordinal`;
      assert.deepEqual(
        positions.map((row) => row.ordinal),
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
      );
    }).pipe(Effect.provide(testLayer)),
);
