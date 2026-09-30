import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_archive_operations (
      thread_id TEXT PRIMARY KEY,
      operation_json TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_archive_operations_retry
    ON thread_archive_operations(next_attempt_at)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_archive_native_bindings (
      thread_id TEXT NOT NULL,
      target_key TEXT NOT NULL,
      initialized_at TEXT NOT NULL,
      PRIMARY KEY(thread_id, target_key)
    )
  `;
});
