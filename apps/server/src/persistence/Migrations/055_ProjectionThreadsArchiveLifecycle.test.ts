import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrate from "./055_ProjectionThreadsArchiveLifecycle.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("archive lifecycle migration", (it) => {
  it.effect(
    "backfills continuous settlement from event sequence, with a safe missing-history fallback",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const migrationAt = "2026-09-30T00:00:00.000Z";
        yield* TestClock.setTime(Date.parse(migrationAt));
        yield* runMigrations({ toMigrationInclusive: 60 });
        for (const [threadId, settledOverride] of [
          ["automatic", "settled"],
          ["resettled", "settled"],
          ["recreated", "settled"],
          ["unknown", "settled"],
          ["active", "active"],
        ]) {
          yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode,
            created_at, updated_at, settled_override, settled_at
          ) VALUES (${threadId}, 'project', 'Thread', '{"instanceId":"codex","model":"gpt-5.4"}',
            'full-access', '2026-01-01T00:00:00.000Z', ${migrationAt}, ${settledOverride},
            '2026-01-01T00:00:00.000Z')
        `;
        }
        const events = [
          ["automatic", "thread.created", "2026-01-01T00:00:00.000Z"],
          ["automatic", "thread.settled", "2026-09-10T00:00:00.000Z"],
          ["automatic", "thread.settled", "2026-09-29T00:00:00.000Z"],
          ["resettled", "thread.settled", "2026-02-01T00:00:00.000Z"],
          ["resettled", "thread.unsettled", "2026-09-25T00:00:00.000Z"],
          ["resettled", "thread.settled", "2026-09-26T00:00:00.000Z"],
          ["resettled", "thread.settled", "2026-09-27T00:00:00.000Z"],
          ["recreated", "thread.settled", "2026-03-01T00:00:00.000Z"],
          ["recreated", "thread.created", "2026-09-20T00:00:00.000Z"],
          ["recreated", "thread.settled", "2026-09-21T00:00:00.000Z"],
        ];
        for (const [index, [threadId, eventType, occurredAt]] of events.entries()) {
          yield* sql`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, actor_kind, payload_json, metadata_json
          ) VALUES (${`event-${index}`}, 'thread', ${threadId}, ${index}, ${eventType},
            ${occurredAt}, 'server', '{}', '{}')
        `;
        }
        yield* runMigrations({ toMigrationInclusive: 61 });
        const rows = yield* sql<{
          readonly threadId: string;
          readonly settledSince: string | null;
          readonly archiveLifecycle: string | null;
        }>`
        SELECT thread_id AS "threadId", settled_since AS "settledSince",
          archive_lifecycle_json AS "archiveLifecycle" FROM projection_threads ORDER BY thread_id
      `;
        assert.deepEqual(rows, [
          { threadId: "active", settledSince: null, archiveLifecycle: null },
          {
            threadId: "automatic",
            settledSince: "2026-09-10T00:00:00.000Z",
            archiveLifecycle: null,
          },
          {
            threadId: "recreated",
            settledSince: "2026-09-21T00:00:00.000Z",
            archiveLifecycle: null,
          },
          {
            threadId: "resettled",
            settledSince: "2026-09-26T00:00:00.000Z",
            archiveLifecycle: null,
          },
          { threadId: "unknown", settledSince: migrationAt, archiveLifecycle: null },
        ]);
        yield* TestClock.setTime(Date.parse("2026-10-05T00:00:00.000Z"));
        yield* migrate;
        const repeated =
          yield* sql`SELECT settled_since AS "settledSince" FROM projection_threads WHERE thread_id = 'unknown'`;
        assert.deepEqual(repeated, [{ settledSince: migrationAt }]);
      }),
  );
});
