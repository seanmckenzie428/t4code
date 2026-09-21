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
import AuthSessionClientConnection from "./041_AuthSessionClientConnection.ts";
import ProjectionThreadLinkedPullRequest from "./042_ProjectionThreadLinkedPullRequest.ts";
import ProjectionThreadsUnsettledAt from "./043_ProjectionThreadsUnsettledAt.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("041_049_ForkCompatibility", (it) => {
  it.effect("adds T4 columns to a database that already recorded upstream 36-43", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* ProjectionThreadsPinned;
      yield* ProjectionTurnsKeysetIndex;
      yield* ProjectionThreadsPinOrderKey;
      yield* ProjectionProjectsDefaultThreadEnvMode;
      yield* ProjectionProjectFaviconPath;
      yield* AuthSessionClientConnection;
      yield* ProjectionThreadLinkedPullRequest;
      yield* ProjectionThreadsUnsettledAt;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES
          (36, 'ProjectionThreadsPinned', CURRENT_TIMESTAMP),
          (37, 'ProjectionTurnsKeysetIndex', CURRENT_TIMESTAMP),
          (38, 'ProjectionThreadsPinOrderKey', CURRENT_TIMESTAMP),
          (39, 'ProjectionProjectsDefaultThreadEnvMode', CURRENT_TIMESTAMP),
          (40, 'ProjectionProjectFaviconPath', CURRENT_TIMESTAMP),
          (41, 'AuthSessionClientConnection', CURRENT_TIMESTAMP),
          (42, 'ProjectionThreadLinkedPullRequest', CURRENT_TIMESTAMP),
          (43, 'ProjectionThreadsUnsettledAt', CURRENT_TIMESTAMP)
      `;

      yield* runMigrations({ toMigrationInclusive: 59 });

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
      assert.ok(threadColumns.some((column) => column.name === "linked_pull_request_json"));
      assert.ok(threadColumns.some((column) => column.name === "unsettled_at"));
      assert.ok(messageColumns.some((column) => column.name === "delegation_json"));
      assert.deepStrictEqual(
        recorded.map((migration) => migration.migration_id),
        Array.from({ length: 19 }, (_, index) => 41 + index),
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
      Array.from({ length: 13 }, (_, index) => 47 + index),
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
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect(
  "appends migration 59 to a populated T4 ledger through 58 without changing existing rows",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 58 });
      const previousLedger = yield* sql`
      SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id
    `;
      yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, kind, system_role,
        custom_actions_json, auto_pull, created_at, updated_at
      ) VALUES (
        'assistant-project-58', 'Environment', '/workspace', '[]', 'system', 'global-assistant',
        '[{"id":"review","name":"Review","placement":"toolbar","commandId":"ui.external-url.open","args":{"url":"https://example.com/review"}}]',
        1, '2026-09-17T00:00:00Z', '2026-09-17T00:00:00Z'
      )
    `;
      yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, kind, workspace_binding_json,
        active_order_key, title_state_json, created_at, updated_at
      ) VALUES (
        'quick-chat-58', 'assistant-project-58', 'Quick Chat', '{"instanceId":"codex","model":"gpt-5"}',
        'quick', '{"extensionId":"workspaces","providerId":"local","workspaceId":"feature"}',
        'a1', '{"source":"generated","version":"title-58","needsRefinement":false}',
        '2026-09-17T00:00:00Z', '2026-09-17T00:00:00Z'
      )
    `;
      yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, role, text, delegation_json, context_json, is_streaming,
        created_at, updated_at
      ) VALUES (
        'delegated-message-58', 'quick-chat-58', 'user', 'Review changes',
        '{"assistantThreadId":"quick-chat-58","actionId":"review","depth":1}',
        '{"version":1,"records":[{"version":1,"contextId":"context-58","label":"terminal output","kind":"terminal","terminalId":"terminal-58","terminalLabel":"Shell","lineStart":1,"lineEnd":1,"text":"preserve this context"}]}', 0,
        '2026-09-17T00:00:00Z', '2026-09-17T00:00:00Z'
      )
    `;
      const readExistingRows = () =>
        Effect.all({
          projects: sql`SELECT * FROM projection_projects ORDER BY project_id`,
          threads: sql`SELECT * FROM projection_threads ORDER BY thread_id`,
          messages: sql`SELECT * FROM projection_thread_messages ORDER BY message_id`,
        });
      const previousRows = yield* readExistingRows();

      assert.deepStrictEqual(yield* runMigrations(), [[59, "PullRequestFilesViewed"]]);
      assert.deepStrictEqual(
        yield* sql`
        SELECT migration_id, name, created_at FROM effect_sql_migrations
        WHERE migration_id <= 58 ORDER BY migration_id
      `,
        previousLedger,
      );
      assert.deepStrictEqual(yield* readExistingRows(), previousRows);

      yield* sql`
      INSERT INTO pull_request_files_viewed (
        provider, host, repository, number, viewer, path, revision, viewed_at
      ) VALUES (
        'gitlab', 'gitlab.example.com', 'team/project', 12, 'reader', 'src/app.ts',
        'sha-before-push', '2026-09-21T00:00:00Z'
      )
    `;
      const viewedRows = yield* sql`SELECT * FROM pull_request_files_viewed`;
      assert.equal(viewedRows.length, 1);
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* sql`SELECT * FROM pull_request_files_viewed`, viewedRows);
      assert.deepStrictEqual(yield* readExistingRows(), previousRows);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
