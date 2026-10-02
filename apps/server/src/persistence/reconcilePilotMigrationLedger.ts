import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import SystemEntities from "./Migrations/036_ProjectionSystemEntities.ts";
import MessageDelegation from "./Migrations/037_ProjectionThreadMessageDelegation.ts";
import ProjectCustomActions from "./Migrations/038_ProjectionProjectCustomActions.ts";
import DefaultThreadEnvMode from "./Migrations/039_ProjectionProjectsDefaultThreadEnvMode.ts";
import ProjectFaviconPath from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import ThreadsPinned from "./Migrations/036_ProjectionThreadsPinned.ts";
import TurnsKeysetIndex from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import ThreadsPinOrderKey from "./Migrations/038_ProjectionThreadsPinOrderKey.ts";
import ArchiveLifecycle from "./Migrations/055_ProjectionThreadsArchiveLifecycle.ts";
import ArchiveOperations from "./Migrations/056_ThreadArchiveOperations.ts";
import { reconcileV2PreviewMigration } from "./reconcileV2PreviewMigration.ts";

/** Normalize an upstream ledger once; shipped Pilot IDs are never rewritten. */
export const reconcilePilotMigrationLedger = Effect.fn("reconcilePilotMigrationLedger")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables =
          yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'`;
        if (tables.length === 0) return [];
        const marker = yield* sql<{
          readonly name: string;
        }>`SELECT name FROM effect_sql_migrations WHERE migration_id = 36`;
        if (marker[0]?.name !== "ProjectionThreadsPinned") return [];
        // T3 preview IDs must be normalized while the ledger still uses T3 IDs.
        yield* reconcileV2PreviewMigration();
        const rows = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
        }>`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 36 ORDER BY migration_id DESC`;
        if (rows.some((row) => row.migration_id > 56)) {
          return yield* new Migrator.MigrationError({
            kind: "BadState",
            message:
              "Cannot map an upstream database with unknown migrations into the Pilot ledger.",
          });
        }
        for (const row of rows) {
          const target =
            row.migration_id <= 38
              ? row.migration_id + 5
              : row.migration_id <= 40
                ? row.migration_id
                : row.migration_id <= 54
                  ? row.migration_id + 6
                  : row.migration_id + 8;
          if (target !== row.migration_id) {
            yield* sql`UPDATE effect_sql_migrations SET migration_id = ${target} WHERE migration_id = ${row.migration_id}`;
          }
        }
        const recordedRows = yield* sql<{
          readonly migration_id: number;
        }>`SELECT migration_id FROM effect_sql_migrations`;
        const recorded = new Set(recordedRows.map((row) => row.migration_id));
        const additions = [
          [36, "ProjectionSystemEntities", SystemEntities],
          [37, "ProjectionThreadMessageDelegation", MessageDelegation],
          [38, "ProjectionProjectCustomActions", ProjectCustomActions],
          // Partial upstream ledgers can stop before 39/40. Fill every gap below
          // the compatibility tail before the max-ID migrator continues.
          [39, "ProjectionProjectsDefaultThreadEnvMode", DefaultThreadEnvMode],
          [40, "ProjectionProjectFaviconPath", ProjectFaviconPath],
          [41, "ProjectionThreadsPinned", ThreadsPinned],
          [42, "ProjectionTurnsKeysetIndex", TurnsKeysetIndex],
          [43, "ProjectionThreadsPinOrderKey", ThreadsPinOrderKey],
          [44, "ProjectionSystemEntitiesCompatibility", SystemEntities],
          [45, "ProjectionThreadMessageDelegationCompatibility", MessageDelegation],
          [46, "ProjectionProjectCustomActionsCompatibility", ProjectCustomActions],
          // V2 may already occupy 63. The normal max-ID migrator cannot run these afterward.
          ...(rows.some((row) => row.name === "OrchestrationV2")
            ? ([
                [61, "ProjectionThreadsArchiveLifecycle", ArchiveLifecycle],
                [62, "ThreadArchiveOperations", ArchiveOperations],
              ] as const)
            : []),
        ] as const;
        const missing = additions.filter(([id]) => !recorded.has(id));
        for (const [id, name, migration] of missing) {
          yield* migration;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
        }
        return missing.map(([id, name]) => [id, name] as const);
      }),
    );
  },
);
