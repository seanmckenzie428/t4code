import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpServer, Tool } from "effect/unstable/ai";

import {
  AppCommandsTool,
  AppControlToolkit,
  AppInvokeTool,
  AppStatusTool,
  AppViewPresentInput,
  AppViewPresentTool,
  AppViewRemoveTool,
} from "./tools.ts";

it.effect("registers every app-control tool during MCP startup", () => {
  const unused = () => Effect.die("Registration must not invoke a tool");
  const handlers = AppControlToolkit.toLayer({
    app_status: unused,
    app_commands: unused,
    app_invoke: unused,
    app_view_present: unused,
    app_view_update: unused,
    app_view_remove: unused,
  });
  return McpServer.registerToolkit(AppControlToolkit).pipe(
    Effect.provide(Layer.mergeAll(handlers, McpServer.McpServer.layer)),
    Effect.scoped,
  );
});

it("marks discovery read-only and all generic mutation paths destructive", () => {
  expect(Context.get(AppStatusTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(AppCommandsTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(AppInvokeTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(AppViewRemoveTool.annotations, Tool.Destructive)).toBe(true);
});

it("exposes exact native view nodes and actions to MCP clients", () => {
  const jsonSchema = JSON.stringify(Schema.toJsonSchemaDocument(AppViewPresentInput));
  expect(jsonSchema).toContain("NativeAppViewNode");
  expect(jsonSchema).toContain('"actions"');
  expect(jsonSchema).toContain('"commandId"');
  expect(jsonSchema).toContain('"children"');
  expect(jsonSchema).toContain('"createNew"');
  expect(AppViewPresentTool.description).toContain("app_status.views");
  expect(AppViewPresentTool.description).toContain("top bar");
  expect(jsonSchema).toContain('"placements"');
  expect(AppStatusTool.description).toContain("generated-view IDs");
  expect(AppStatusTool.description).toContain("add this to T4");
});
