import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import ProjectionThreadsPinned from "./036_ProjectionThreadsPinned.ts";
import ProjectionTurnsKeysetIndex from "./037_ProjectionTurnsKeysetIndex.ts";
import ProjectionThreadsPinOrderKey from "./038_ProjectionThreadsPinOrderKey.ts";
import ProjectionProjectsDefaultThreadEnvMode from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import ProjectionProjectFaviconPath from "./040_ProjectionProjectFaviconPath.ts";
import AuthSessionClientConnection from "./041_AuthSessionClientConnection.ts";
import ProjectionThreadLinkedPullRequest from "./042_ProjectionThreadLinkedPullRequest.ts";
import ProjectionThreadsUnsettledAt from "./043_ProjectionThreadsUnsettledAt.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

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

      yield* runMigrations({ toMigrationInclusive: 49 });

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
        [41, 42, 43, 44, 45, 46, 47, 48, 49],
      );
    }),
  );
});
