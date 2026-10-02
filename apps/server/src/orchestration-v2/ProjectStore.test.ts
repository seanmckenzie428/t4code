import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";

it.layer(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
  "ProjectStoreV2",
  (it) => {
    it.effect("stores a model selection without options as JSON without an options key", () =>
      Effect.gen(function* () {
        const projects = yield* ProjectStore.ProjectStoreV2;
        const sql = yield* SqlClient.SqlClient;
        const projectId = ProjectId.make("project-null-options");
        const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make("event-null-options"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: "2026-03-24T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "Null options project",
            workspaceRoot: "/tmp/project-null-options",
            defaultModelSelection: modelSelection,
            scripts: [],
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          },
        });

        const rows = yield* sql<{ readonly defaultModelSelection: string | null }>`
          SELECT default_model_selection_json AS "defaultModelSelection"
          FROM projection_projects
          WHERE project_id = ${projectId}
        `;
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        assert.strictEqual(rows[0]?.defaultModelSelection, JSON.stringify(modelSelection));
        assert.deepStrictEqual(
          (yield* projects.getShell(projectId)).pipe(Option.getOrNull)?.customActions,
          [],
        );
        assert.deepStrictEqual(
          Option.getOrNull(yield* projects.get(projectId))?.defaultModelSelection,
          modelSelection,
        );
      }),
    );
  },
);

it.effect("keeps custom actions and hides retired system projects", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projects = yield* ProjectStore.ProjectStoreV2;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, kind, custom_actions_json, created_at, updated_at)
      VALUES ('pilot-visible', 'Visible', '/visible', '[]', 'workspace', '[{"id":"review","name":"Review","icon":"link","placement":"toolbar","commandId":"ui.external-url.open","args":{"url":"https://example.com"}}]', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ('pilot-hidden', 'Hidden', '/hidden', '[]', 'system', '[]', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`;
    const shells = yield* projects.listShells();
    assert.deepEqual(
      shells.map((project) => project.id),
      ["pilot-visible"],
    );
    assert.equal(shells[0]?.customActions?.[0]?.id, "review");
    assert.isTrue(Option.isNone(yield* projects.get(ProjectId.make("pilot-hidden"))));
    assert.isTrue(Option.isNone(yield* projects.findActiveByWorkspaceRoot("/hidden")));
  }).pipe(Effect.provide(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))),
);
