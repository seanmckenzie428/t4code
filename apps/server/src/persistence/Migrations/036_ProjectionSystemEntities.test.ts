import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import migration from "./036_ProjectionSystemEntities.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_ProjectionSystemEntities", (it) => {
  it.effect("adds backward-compatible system entity columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY)`;
      yield* sql`CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY)`;

      yield* migration;

      const projectColumns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`
        PRAGMA table_info(projection_projects)
      `;
      const threadColumns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`
        PRAGMA table_info(projection_threads)
      `;
      expect(projectColumns.find((column) => column.name === "kind")?.dflt_value).toBe(
        "'workspace'",
      );
      expect(projectColumns.some((column) => column.name === "system_role")).toBe(true);
      expect(threadColumns.find((column) => column.name === "kind")?.dflt_value).toBe("'project'");
      expect(threadColumns.some((column) => column.name === "workspace_binding_json")).toBe(true);
    }),
  );
});
