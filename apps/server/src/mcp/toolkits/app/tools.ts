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
      'Inspect bounded environment-wide Pilot application state, including the focused client, projects, threads, current generated-view IDs/titles/revisions/scopes, and semantic commands available to this provider session. A regular project chat may inspect and control any project or thread in this environment, including starting delegated work in another thread; cross-environment control remains unavailable. When the user says "add this to Pilot", "put this in Pilot", "show this in Pilot", or refers to "the app" for a view, dashboard, control, or interactive tool, interpret it as a generated in-app UI request. Inspect views metadata before presenting or updating generated UI; do not edit product source merely to fulfill that request unless the user explicitly asks to change the product itself.',
    parameters: Tool.EmptyParams,
    success: AppControlSnapshot,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Inspect Pilot application state"),
);

export const AppCommandsInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  risks: Schema.optional(Schema.Array(AppControlRisk)),
});

export const AppCommandsTool = readonlyTool(
  Tool.make("app_commands", {
    description:
      "List typed semantic Pilot commands. Filter by domain or risk before invoking a command. Approval and user-input response commands are never exposed.",
    parameters: AppCommandsInput,
    success: Schema.Array(AppCommandDescriptor),
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "List Pilot commands"),
);

export const AppInvokeTool = controlTool(
  Tool.make("app_invoke", {
    description:
      "Invoke one typed semantic Pilot command by ID. Commands stay inside this environment and may require a grant or explicit human confirmation based on risk. Regular project chats may target another project or thread in the environment.",
    parameters: AppCommandInvocation,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Invoke Pilot command"),
);

export const AppViewPresentInput = Schema.Struct({
  actionId: AppActionId,
  manifest: AppViewManifest,
  createNew: Schema.optional(Schema.Boolean),
});

export const AppViewPresentTool = controlTool(
  Tool.make("app_view_present", {
    description:
      "Present bounded native or sandboxed UI inside Pilot. First inspect app_status.views: when a matching logical view already exists, update it with app_view_update instead. Presenting the same title and kind also updates that thread view as a fallback. Set createNew true only when the user explicitly asks for a distinct additional view. The result reports the actual viewId and revision. Native root nodes expose id, type, title, value, variant, columns, input, bindings, actions, and children. Optional placements can add native-styled launchers to the top bar, active-project sidebar, or right-panel launcher grid; omitted placements keep the generated-view dock behavior. For a top-bar dropdown button like Add action, use action { menu: [{ label, action: { commandId, args } }] }. For a split button like Open or Commit & push, use action { primary: { commandId, args }, menu: [...] }; the labeled button runs primary and the separate chevron opens menu. A single ui.external-url.open/ui.preview.open action creates a regular button; without action the launcher opens the generated view. Each node action renders a button and requires id, label, commandId, plus optional args. Inline host code, arbitrary CSS, and direct parent-app access are unsupported.",
    parameters: AppViewPresentInput,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Present generated Pilot view"),
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
  }).annotate(Tool.Title, "Update generated Pilot view"),
);

export const AppViewRemoveInput = Schema.Struct({
  actionId: AppActionId,
  viewId: AppViewId,
});

export const AppViewRemoveTool = controlTool(
  Tool.make("app_view_remove", {
    description:
      "Remove a generated Pilot view. Pinned or durable views may require human confirmation.",
    parameters: AppViewRemoveInput,
    success: AppCommandResult,
    failure: AppControlError,
    dependencies,
  }).annotate(Tool.Title, "Remove generated Pilot view"),
);

export const AppControlToolkit = Toolkit.make(
  AppStatusTool,
  AppCommandsTool,
  AppInvokeTool,
  AppViewPresentTool,
  AppViewUpdateTool,
  AppViewRemoveTool,
);
