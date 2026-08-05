import {
  AppActionId,
  AppCommandDescriptor,
  AppCommandInvocation,
  AppCommandResult,
  AppControlError,
  AppControlRisk,
  AppControlSnapshot,
  AppViewId,
  AppViewManifest,
  AppViewRevision,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as AppControlBroker from "../../AppControlBroker.ts";
import * as AppControlPolicy from "../../AppControlPolicy.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  AppControlBroker.AppControlBroker,
  AppControlPolicy.AppControlPolicy,
];

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true) as T;

const controlTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, false).annotate(Tool.Destructive, true) as T;

export const AppStatusTool = readonlyTool(
  Tool.make("app_status", {
    description:
      'Inspect bounded T3 application state, including the focused client, projects, threads, current generated-view IDs/titles/revisions/scopes, and semantic commands available to this provider session. T3 Code may be branded T4 Code. When the user says "add this to T4", "put this in T4", "show this in T4", or uses the same phrasing with T3 or "the app" for a view, dashboard, control, or interactive tool, interpret it as a generated in-app UI request. Inspect views metadata before presenting or updating generated UI; do not edit product source merely to fulfill that request unless the user explicitly asks to change the product itself.',
    parameters: Schema.Struct({}),
    success: AppControlSnapshot,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Inspect T3 application state"),
);

export const AppCommandsInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  risks: Schema.optional(Schema.Array(AppControlRisk)),
});

export const AppCommandsTool = readonlyTool(
  Tool.make("app_commands", {
    description:
      "List typed semantic T3 commands. Filter by domain or risk before invoking a command. Approval and user-input response commands are never exposed.",
    parameters: AppCommandsInput,
    success: Schema.Array(AppCommandDescriptor),
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "List T3 commands"),
);

export const AppInvokeTool = controlTool(
  Tool.make("app_invoke", {
    description:
      "Invoke one typed semantic T3 command by ID. Commands are scope checked and may require a grant or explicit human confirmation based on risk.",
    parameters: AppCommandInvocation,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Invoke T3 command"),
);

export const AppViewPresentInput = Schema.Struct({
  actionId: AppActionId,
  manifest: AppViewManifest,
  createNew: Schema.optional(Schema.Boolean),
});

export const AppViewPresentTool = controlTool(
  Tool.make("app_view_present", {
    description:
      "Present bounded native or sandboxed UI inside T3/T4 Code. First inspect app_status.views: when a matching logical view already exists, update it with app_view_update instead. Presenting the same title and kind also updates that thread view as a fallback. Set createNew true only when the user explicitly asks for a distinct additional view. The result reports the actual viewId and revision. Native root nodes expose id, type, title, value, variant, columns, input, bindings, actions, and children. Optional placements can add native-styled launchers to the top bar, active-project sidebar, or right-panel launcher grid; omitted placements keep the generated-view dock behavior. A placement may use action { commandId: ui.external-url.open, args: { url } } for an approved HTTP(S) link or { commandId: ui.preview.open, args: { url } } to open it in T3's dedicated browser; without action it opens the generated view. Each node action renders a button and requires id, label, commandId, plus optional args. Inline host code, arbitrary CSS, and direct parent-app access are unsupported.",
    parameters: AppViewPresentInput,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Present generated T3 view"),
);

export const AppViewUpdateInput = Schema.Struct({
  actionId: AppActionId,
  viewId: AppViewId,
  expectedRevision: AppViewRevision,
  manifest: AppViewManifest,
});

export const AppViewUpdateTool = controlTool(
  Tool.make("app_view_update", {
    description:
      "Replace an existing generated view when its revision still matches the supplied expected revision.",
    parameters: AppViewUpdateInput,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Update generated T3 view"),
);

export const AppViewRemoveInput = Schema.Struct({
  actionId: AppActionId,
  viewId: AppViewId,
});

export const AppViewRemoveTool = controlTool(
  Tool.make("app_view_remove", {
    description:
      "Remove a generated T3 view. Pinned or durable views may require human confirmation.",
    parameters: AppViewRemoveInput,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Remove generated T3 view"),
);

export const AppControlToolkit = Toolkit.make(
  AppStatusTool,
  AppCommandsTool,
  AppInvokeTool,
  AppViewPresentTool,
  AppViewUpdateTool,
  AppViewRemoveTool,
);
