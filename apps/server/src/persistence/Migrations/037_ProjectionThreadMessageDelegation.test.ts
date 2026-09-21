import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import migration from "./037_ProjectionThreadMessageDelegation.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("037_ProjectionThreadMessageDelegation", (it) => {
  it.effect("adds delegation metadata to projected messages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_thread_messages (message_id TEXT PRIMARY KEY)`;
      yield* migration;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      expect(columns.some((column) => column.name === "delegation_json")).toBe(true);
    }),
  );
});
