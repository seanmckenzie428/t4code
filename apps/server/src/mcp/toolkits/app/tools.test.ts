import { expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import {
  AppCommandsTool,
  AppInvokeTool,
  AppStatusTool,
  AppViewPresentInput,
  AppViewPresentTool,
  AppViewRemoveTool,
} from "./tools.ts";

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
  expect(AppStatusTool.description).toContain("generated-view IDs");
});
