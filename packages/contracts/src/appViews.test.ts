import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  APP_VIEW_MAX_NODES,
  NativeAppViewManifest,
  SANDBOXED_APP_VIEW_MAX_HTML_BYTES,
  SandboxedAppViewManifest,
} from "./appViews.ts";

const nativeManifest = {
  id: "view-1",
  revision: 1,
  title: "Workspace cockpit",
  scope: { kind: "thread", threadId: "thread-1" },
  kind: "native",
  root: {
    id: "root",
    type: "section",
    children: [
      {
        id: "health",
        type: "metric",
        title: "Health",
        value: "healthy",
        actions: [{ id: "refresh", label: "Refresh", commandId: "source.refresh" }],
      },
    ],
  },
} as const;

it.effect("decodes bounded native views with registered-command actions", () =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(NativeAppViewManifest)(nativeManifest);
    assert.strictEqual(parsed.root.children?.[0]?.actions?.[0]?.commandId, "source.refresh");
  }),
);

it("publishes the recursive native node and action shape in JSON Schema", () => {
  const jsonSchema = JSON.stringify(Schema.toJsonSchemaDocument(NativeAppViewManifest));
  assert.strictEqual(jsonSchema.includes("NativeAppViewNode"), true);
  assert.strictEqual(jsonSchema.includes('"actions"'), true);
  assert.strictEqual(jsonSchema.includes('"commandId"'), true);
  assert.strictEqual(jsonSchema.includes('"children"'), true);
});

it.effect("rejects native views deeper than the manifest bound", () =>
  Effect.gen(function* () {
    let root: Record<string, unknown> = { id: "leaf", type: "text", value: "done" };
    for (let index = 0; index < 8; index += 1) {
      root = { id: `node-${index}`, type: "section", children: [root] };
    }
    const exit = yield* Effect.exit(
      Schema.decodeUnknownEffect(NativeAppViewManifest)({ ...nativeManifest, root }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("rejects native views beyond the node bound", () =>
  Effect.gen(function* () {
    const root = {
      id: "root",
      type: "stack",
      children: Array.from({ length: APP_VIEW_MAX_NODES }, (_, index) => ({
        id: `node-${index}`,
        type: "text",
        value: index,
      })),
    };
    const exit = yield* Effect.exit(
      Schema.decodeUnknownEffect(NativeAppViewManifest)({ ...nativeManifest, root }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("rejects evaluated, prototype, and input-source bindings", () =>
  Effect.gen(function* () {
    for (const binding of [
      { path: "value", source: "snapshot", sourcePath: "$.health()" },
      { path: "value", source: "snapshot", sourcePath: "$.__proto__.polluted" },
      { path: "value", source: "input", sourcePath: "$.name" },
    ]) {
      const exit = yield* Effect.exit(
        Schema.decodeUnknownEffect(NativeAppViewManifest)({
          ...nativeManifest,
          root: { id: "root", type: "text", bindings: [binding] },
        }),
      );
      assert.strictEqual(exit._tag, "Failure");
    }
  }),
);

it.effect("rejects native payloads beyond 256 KiB", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Schema.decodeUnknownEffect(NativeAppViewManifest)({
        ...nativeManifest,
        root: { id: "root", type: "text", value: "x".repeat(257 * 1024) },
      }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("decodes sandboxed views with an explicit command bridge", () =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(SandboxedAppViewManifest)({
      id: "rich-view-1",
      revision: 1,
      title: "Rich view",
      scope: { kind: "personal" },
      kind: "sandboxed",
      html: "<!doctype html><p>Hello</p>",
      commandIds: ["quick-chat.toggle"],
    });
    assert.strictEqual(parsed.commandIds[0], "quick-chat.toggle");
  }),
);

it.effect("decodes MCP Apps bundled resources and remote placeholders", () =>
  Effect.gen(function* () {
    const bundled = yield* Schema.decodeUnknownEffect(SandboxedAppViewManifest)({
      id: "rich-view-1",
      revision: 1,
      title: "Rich view",
      scope: { kind: "personal" },
      kind: "sandboxed",
      html: "<p>Hello</p>",
      resource: { kind: "bundled", uri: "ui://example/view", mimeType: "text/html" },
      tool: { name: "example", resourceUri: "ui://example/view" },
      commandIds: [],
    });
    const remote = yield* Schema.decodeUnknownEffect(SandboxedAppViewManifest)({
      id: "remote-view",
      revision: 1,
      title: "Remote view",
      scope: { kind: "personal" },
      kind: "sandboxed",
      resource: { kind: "remote", uri: "https://apps.example.com/view", mimeType: "text/html" },
      tool: { name: "example", resourceUri: "https://apps.example.com/view" },
      commandIds: [],
    });
    assert.strictEqual(bundled.resource?.kind, "bundled");
    assert.strictEqual(remote.resource?.kind, "remote");
  }),
);

it.effect("rejects malformed origins, mismatched resources, and oversized HTML", () =>
  Effect.gen(function* () {
    const base = {
      id: "rich-view-1",
      revision: 1,
      title: "Rich view",
      scope: { kind: "personal" },
      kind: "sandboxed",
      html: "<p>Hello</p>",
      resource: { kind: "bundled", uri: "ui://example/view", mimeType: "text/html" },
      tool: { name: "example", resourceUri: "ui://example/view" },
      commandIds: [],
    };
    for (const candidate of [
      { ...base, externalOrigins: ["http://example.com"] },
      { ...base, externalOrigins: ["https://example.com/path"] },
      { ...base, tool: { name: "example", resourceUri: "ui://other/view" } },
      { ...base, html: "x".repeat(SANDBOXED_APP_VIEW_MAX_HTML_BYTES + 1) },
    ]) {
      const exit = yield* Effect.exit(
        Schema.decodeUnknownEffect(SandboxedAppViewManifest)(candidate),
      );
      assert.strictEqual(exit._tag, "Failure");
    }
  }),
);
