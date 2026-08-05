import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import migration from "./038_ProjectionProjectCustomActions.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("038_ProjectionProjectCustomActions", (it) => {
  it.effect("adds an empty-array default for legacy project rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY)`;
      yield* sql`INSERT INTO projection_projects (project_id) VALUES ('project-1')`;

      yield* migration;

      const rows = yield* sql<{ readonly customActions: string }>`
        SELECT custom_actions_json AS "customActions"
        FROM projection_projects
        WHERE project_id = 'project-1'
      `;
      expect(rows[0]?.customActions).toBe("[]");
    }),
  );
});
