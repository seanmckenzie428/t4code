import { expect, it } from "@effect/vitest";
import {
  AppViewId,
  AppViewRevision,
  ProjectId,
  type NativeAppViewManifest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { mergeProjectAppView } from "./ProjectAppViewFile.ts";

const projectId = ProjectId.make("project-1");
const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const manifest = (revision: number): NativeAppViewManifest => ({
  id: AppViewId.make("cockpit"),
  revision: AppViewRevision.make(revision),
  title: "Project cockpit",
  kind: "native",
  scope: { kind: "project", projectId },
  root: { id: "root", type: "text", value: `Revision ${revision}` },
});

it.effect("adds a generated view while preserving unrelated t3.json fields", () =>
  Effect.gen(function* () {
    const result = yield* mergeProjectAppView(
      projectId,
      '{\n    "iconPath": "assets/logo.svg",\n    "futureField": true\n}\n',
      manifest(1),
    );

    expect(result.change).toBe("created");
    expect(result.contents).toContain('\n    "appViews"');
    expect(decodeJson(result.contents)).toMatchObject({
      iconPath: "assets/logo.svg",
      futureField: true,
      appViews: [{ id: "cockpit", revision: 1 }],
    });
    expect(
      (decodeJson(result.contents) as { appViews: Array<{ scope: unknown }> }).appViews[0]?.scope,
    ).toEqual({ kind: "project" });
  }),
);

it.effect("replaces the existing view with the same stable id", () =>
  Effect.gen(function* () {
    const first = yield* mergeProjectAppView(projectId, null, manifest(1));
    const second = yield* mergeProjectAppView(projectId, first.contents, manifest(2));

    expect(second.change).toBe("updated");
    const decoded = decodeJson(second.contents) as {
      readonly appViews: ReadonlyArray<{ readonly revision: number }>;
    };
    expect(decoded.appViews).toHaveLength(1);
    expect(decoded.appViews[0]?.revision).toBe(2);
  }),
);

it.effect("rejects a view scoped to a different project", () =>
  mergeProjectAppView(ProjectId.make("project-2"), null, manifest(1)).pipe(
    Effect.flip,
    Effect.tap((error) => Effect.sync(() => expect(error.failure).toBe("manifest_scope_mismatch"))),
  ),
);
