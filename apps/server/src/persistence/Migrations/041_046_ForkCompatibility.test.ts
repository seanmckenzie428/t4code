import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import ProjectionThreadsPinned from "./036_ProjectionThreadsPinned.ts";
import ProjectionTurnsKeysetIndex from "./037_ProjectionTurnsKeysetIndex.ts";
import ProjectionThreadsPinOrderKey from "./038_ProjectionThreadsPinOrderKey.ts";
import ProjectionProjectsDefaultThreadEnvMode from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import ProjectionProjectFaviconPath from "./040_ProjectionProjectFaviconPath.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_046_ForkCompatibility", (it) => {
  it.effect("adds T4 columns to a database that already recorded upstream 36-40", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* ProjectionThreadsPinned;
      yield* ProjectionTurnsKeysetIndex;
      yield* ProjectionThreadsPinOrderKey;
      yield* ProjectionProjectsDefaultThreadEnvMode;
      yield* ProjectionProjectFaviconPath;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES
          (36, 'ProjectionThreadsPinned', CURRENT_TIMESTAMP),
          (37, 'ProjectionTurnsKeysetIndex', CURRENT_TIMESTAMP),
          (38, 'ProjectionThreadsPinOrderKey', CURRENT_TIMESTAMP),
          (39, 'ProjectionProjectsDefaultThreadEnvMode', CURRENT_TIMESTAMP),
          (40, 'ProjectionProjectFaviconPath', CURRENT_TIMESTAMP)
      `;

      yield* runMigrations();

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const messageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      const recorded = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id
        FROM effect_sql_migrations
        WHERE migration_id >= 41
        ORDER BY migration_id
      `;

      assert.ok(projectColumns.some((column) => column.name === "kind"));
      assert.ok(projectColumns.some((column) => column.name === "system_role"));
      assert.ok(projectColumns.some((column) => column.name === "custom_actions_json"));
      assert.ok(threadColumns.some((column) => column.name === "workspace_binding_json"));
      assert.ok(messageColumns.some((column) => column.name === "delegation_json"));
      assert.deepStrictEqual(
        recorded.map((migration) => migration.migration_id),
        Array.from({ length: 18 }, (_, index) => 41 + index),
      );
    }),
  );
});

it.effect("upgrades the shipped T4 ledger through 46 without losing fork data", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 46 });
    const previousLedger = yield* sql`
      SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
    `;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, kind, system_role,
        custom_actions_json, created_at, updated_at
      ) VALUES (
        'assistant-project', 'Environment', '/workspace', '[]', 'system', 'global-assistant',
        '[{"id":"review","name":"Review","placement":"toolbar","commandId":"ui.external-url.open","args":{"url":"https://example.com/review"}}]',
        '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, kind, workspace_binding_json,
        created_at, updated_at
      ) VALUES (
        'quick-chat', 'assistant-project', 'Quick Chat', '{"provider":"codex","model":"gpt-5"}',
        'assistant', '{"extensionId":"workspaces","providerId":"local","workspaceId":"feature"}',
        '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'
      )
    `;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, role, text, delegation_json, is_streaming, created_at, updated_at
      ) VALUES (
        'delegated-message', 'quick-chat', 'user', 'Review changes',
        '{"assistantThreadId":"quick-chat","actionId":"review","depth":1}', 0,
        '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'
      )
    `;
    const readForkData = () => sql`
      SELECT p.kind AS project_kind, p.system_role, p.custom_actions_json,
        t.kind AS thread_kind, t.workspace_binding_json, m.delegation_json
      FROM projection_projects p
      JOIN projection_threads t ON t.project_id = p.project_id
      JOIN projection_thread_messages m ON m.thread_id = t.thread_id
    `;
    const previousData = yield* readForkData();

    const executed = yield* runMigrations();

    assert.deepStrictEqual(
      executed.map(([id]) => id),
      Array.from({ length: 12 }, (_, index) => 47 + index),
    );
    assert.deepStrictEqual(
      yield* sql`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id <= 46 ORDER BY migration_id
      `,
      previousLedger,
    );
    assert.deepStrictEqual(yield* readForkData(), previousData);
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
