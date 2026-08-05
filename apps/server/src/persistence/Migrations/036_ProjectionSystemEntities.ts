import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!projectColumns.some((column) => column.name === "kind")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'workspace'
    `;
  }
  if (!projectColumns.some((column) => column.name === "system_role")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN system_role TEXT
    `;
  }
  if (!threadColumns.some((column) => column.name === "kind")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'
    `;
  }
  if (!threadColumns.some((column) => column.name === "workspace_binding_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workspace_binding_json TEXT
    `;
  }
});
