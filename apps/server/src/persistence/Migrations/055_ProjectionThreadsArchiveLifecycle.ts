import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  if (!columns.some((column) => column.name === "settled_since")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN settled_since TEXT`;
  }
  if (!columns.some((column) => column.name === "archive_lifecycle_json")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN archive_lifecycle_json TEXT`;
  }

  const migrationAt = DateTime.formatIso(yield* DateTime.now);
  // Duplicate settles do not begin another interval. Sequence order also
  // handles client clocks and thread IDs reused after a draft retry.
  yield* sql`
    UPDATE projection_threads AS thread
    SET settled_since = COALESCE((
      SELECT settled.occurred_at
      FROM orchestration_events AS settled
      WHERE settled.aggregate_kind = 'thread'
        AND settled.stream_id = thread.thread_id
        AND settled.event_type = 'thread.settled'
        AND settled.sequence > COALESCE((
          SELECT MAX(reset.sequence)
          FROM orchestration_events AS reset
          WHERE reset.aggregate_kind = 'thread'
            AND reset.stream_id = thread.thread_id
            AND reset.event_type IN ('thread.created', 'thread.unsettled')
        ), -1)
        AND julianday(settled.occurred_at) IS NOT NULL
      ORDER BY settled.sequence ASC
      LIMIT 1
    ), ${migrationAt})
    WHERE thread.settled_override = 'settled'
      AND thread.settled_since IS NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_settled_since
    ON projection_threads(settled_since, thread_id)
    WHERE deleted_at IS NULL AND archived_at IS NULL AND settled_override = 'settled'
  `;
});
