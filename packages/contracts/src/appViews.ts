import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { AppCommandId } from "./appControl.ts";

export const APP_VIEW_MAX_NODES = 200;
export const APP_VIEW_MAX_DEPTH = 8;
export const APP_VIEW_MAX_PAYLOAD_BYTES = 256 * 1024;
export const SANDBOXED_APP_VIEW_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const SANDBOXED_APP_VIEW_MAX_EXTERNAL_ORIGINS = 16;

export const AppViewId = TrimmedNonEmptyString.pipe(Schema.brand("AppViewId"));
export type AppViewId = typeof AppViewId.Type;
export const AppViewRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("AppViewRevision"),
);
export type AppViewRevision = typeof AppViewRevision.Type;

export const AppViewScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("personal") }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
]);
export type AppViewScope = typeof AppViewScope.Type;

export const APP_VIEW_PLACEMENT_SLOTS = [
  "chat-topbar",
  "project-sidebar",
  "right-panel-launcher",
] as const;
export const AppViewPlacementSlot = Schema.Literals(APP_VIEW_PLACEMENT_SLOTS);
export type AppViewPlacementSlot = typeof AppViewPlacementSlot.Type;

export const APP_VIEW_PLACEMENT_ICONS = [
  "sparkles",
  "dashboard",
  "globe",
  "terminal",
  "files",
  "diff",
  "database",
  "server",
  "link",
] as const;
export const AppViewPlacementIcon = Schema.Literals(APP_VIEW_PLACEMENT_ICONS);
export type AppViewPlacementIcon = typeof AppViewPlacementIcon.Type;

export const APP_VIEW_RIGHT_PANEL_LAUNCHER_TARGETS = [
  "generated-views",
  "browser",
  "terminal",
  "files",
  "diff",
] as const;
export const AppViewRightPanelLauncherTarget = Schema.Literals(
  APP_VIEW_RIGHT_PANEL_LAUNCHER_TARGETS,
);
export type AppViewRightPanelLauncherTarget = typeof AppViewRightPanelLauncherTarget.Type;

export const AppViewPlacement = Schema.Struct({
  slot: AppViewPlacementSlot,
  mode: Schema.optionalKey(Schema.Literals(["append", "replace"])),
  targetId: Schema.optionalKey(AppViewRightPanelLauncherTarget),
  label: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  description: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  icon: Schema.optionalKey(AppViewPlacementIcon),
  order: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: -100, maximum: 100 }))),
}).check(
  Schema.makeFilter((placement) => {
    const mode = placement.mode ?? "append";
    if (mode === "replace") {
      return (
        (placement.slot === "right-panel-launcher" && placement.targetId !== undefined) ||
        "Replacement placements require a right-panel-launcher targetId."
      );
    }
    return (
      placement.targetId === undefined ||
      "Append placements cannot target a built-in right-panel launcher."
    );
  }),
);
export type AppViewPlacement = typeof AppViewPlacement.Type;

const AppViewPlacements = Schema.Array(AppViewPlacement)
  .check(Schema.isMaxLength(12))
  .check(
    Schema.makeFilter((placements) => {
      const keys = placements.map(
        (placement) =>
          `${placement.slot}:${placement.mode ?? "append"}:${placement.targetId ?? ""}`,
      );
      return new Set(keys).size === keys.length || "App view placements must be unique.";
    }),
  );

const APP_VIEW_BINDING_PATH = /^\$?(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/;
const APP_VIEW_FORBIDDEN_PATH_SEGMENT = /(?:^|\.)(?:__proto__|constructor|prototype)(?:\.|$)/;

export const AppViewBindingSourcePath = TrimmedNonEmptyString.check(
  Schema.makeFilter(
    (path) =>
      path === "$" ||
      (APP_VIEW_BINDING_PATH.test(path) && !APP_VIEW_FORBIDDEN_PATH_SEGMENT.test(path)) ||
      "App view bindings require an explicit property path.",
  ),
);

export const AppViewBinding = Schema.Struct({
  path: Schema.Literals(["value", "$.value"]),
  source: Schema.Literals(["snapshot", "tool-result"]),
  sourcePath: AppViewBindingSourcePath,
});
export type AppViewBinding = typeof AppViewBinding.Type;

export const AppViewAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  commandId: AppCommandId,
  args: Schema.optional(Schema.Unknown),
  confirm: Schema.optional(Schema.Boolean),
}).annotate({
  description:
    "A visible button rendered below its node. commandId must name a registered semantic T3 command; args are passed to that command.",
});
export type AppViewAction = typeof AppViewAction.Type;

export interface NativeAppViewNodeType {
  readonly id: string;
  readonly type:
    | "stack"
    | "grid"
    | "tabs"
    | "section"
    | "text"
    | "markdown"
    | "metric"
    | "badge"
    | "key-value"
    | "list"
    | "table"
    | "chart"
    | "input";
  readonly title?: string;
  readonly value?: unknown;
  readonly variant?: "default" | "muted" | "accent" | "success" | "warning" | "danger";
  readonly columns?: number;
  readonly input?: {
    readonly name: string;
    readonly kind: "text" | "select" | "checkbox" | "radio" | "textarea";
    readonly label: string;
    readonly options?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  };
  readonly bindings?: ReadonlyArray<AppViewBinding>;
  readonly actions?: ReadonlyArray<AppViewAction>;
  readonly children?: ReadonlyArray<NativeAppViewNodeType>;
}

export interface NativeAppViewNodeEncodedType extends Omit<
  NativeAppViewNodeType,
  "actions" | "children"
> {
  readonly actions?: ReadonlyArray<
    Omit<AppViewAction, "commandId"> & { readonly commandId: string }
  >;
  readonly children?: ReadonlyArray<NativeAppViewNodeEncodedType>;
}

const NativeAppViewNodeRef = Schema.suspend(
  (): Schema.Codec<NativeAppViewNodeType, NativeAppViewNodeEncodedType> => NativeAppViewNode,
);
export const NativeAppViewNode: Schema.Codec<NativeAppViewNodeType, NativeAppViewNodeEncodedType> =
  Schema.Struct({
    id: TrimmedNonEmptyString,
    type: Schema.Literals([
      "stack",
      "grid",
      "tabs",
      "section",
      "text",
      "markdown",
      "metric",
      "badge",
      "key-value",
      "list",
      "table",
      "chart",
      "input",
    ]),
    title: Schema.optionalKey(TrimmedNonEmptyString),
    value: Schema.optionalKey(Schema.Unknown),
    variant: Schema.optionalKey(
      Schema.Literals(["default", "muted", "accent", "success", "warning", "danger"]),
    ),
    columns: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))),
    input: Schema.optionalKey(
      Schema.Struct({
        name: TrimmedNonEmptyString,
        kind: Schema.Literals(["text", "select", "checkbox", "radio", "textarea"]),
        label: TrimmedNonEmptyString,
        options: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({ label: TrimmedNonEmptyString, value: TrimmedNonEmptyString }),
          ),
        ),
      }),
    ),
    bindings: Schema.optionalKey(Schema.Array(AppViewBinding)),
    actions: Schema.optionalKey(Schema.Array(AppViewAction)),
    children: Schema.optionalKey(Schema.Array(NativeAppViewNodeRef)),
  }).annotate({
    identifier: "NativeAppViewNode",
    description:
      "Declarative native view node. Put AppViewAction objects in actions to render buttons; nest layout/content nodes in children.",
  });
export type NativeAppViewNode = typeof NativeAppViewNode.Type;

const AppViewManifestBase = {
  id: AppViewId,
  revision: AppViewRevision,
  title: TrimmedNonEmptyString,
  scope: AppViewScope,
  placements: Schema.optionalKey(AppViewPlacements),
} as const;

function validateNativeAppViewManifest(manifest: {
  readonly root: NativeAppViewNodeType;
}): boolean | string {
  let nodes = 0;
  const visit = (node: NativeAppViewNodeType, depth: number): boolean => {
    nodes += 1;
    if (nodes > APP_VIEW_MAX_NODES || depth > APP_VIEW_MAX_DEPTH) return false;
    return node.children?.every((child) => visit(child, depth + 1)) ?? true;
  };
  if (!visit(manifest.root, 1)) {
    return `Native app views are limited to ${APP_VIEW_MAX_NODES} nodes and depth ${APP_VIEW_MAX_DEPTH}.`;
  }
  return (
    new TextEncoder().encode(JSON.stringify(manifest)).byteLength <= APP_VIEW_MAX_PAYLOAD_BYTES ||
    `Native app view payload exceeds ${APP_VIEW_MAX_PAYLOAD_BYTES} bytes.`
  );
}

export const NativeAppViewManifest = Schema.Struct({
  ...AppViewManifestBase,
  kind: Schema.Literal("native"),
  root: NativeAppViewNode,
}).check(Schema.makeFilter(validateNativeAppViewManifest));
export type NativeAppViewManifest = typeof NativeAppViewManifest.Type;

const SandboxedAppViewResourceUri = TrimmedNonEmptyString.check(
  Schema.makeFilter(
    (value) =>
      value.startsWith("ui://") ||
      value.startsWith("https://") ||
      "Sandboxed app view resources require a ui:// or https:// URI.",
  ),
);

const SandboxedAppViewExternalOrigin = TrimmedNonEmptyString.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" &&
          value === url.origin &&
          url.username === "" &&
          url.password === "") ||
        "Sandboxed app view external origins must be exact HTTPS origins."
      );
    } catch {
      return "Sandboxed app view external origins must be exact HTTPS origins.";
    }
  }),
);

export const SandboxedAppViewResource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("bundled"),
    uri: SandboxedAppViewResourceUri,
    mimeType: Schema.Literal("text/html"),
  }),
  Schema.Struct({
    kind: Schema.Literal("remote"),
    uri: SandboxedAppViewResourceUri,
    mimeType: Schema.Literal("text/html"),
  }),
]);
export type SandboxedAppViewResource = typeof SandboxedAppViewResource.Type;

function validateSandboxedAppViewManifest(manifest: {
  readonly html?: string | undefined;
  readonly resource?: SandboxedAppViewResource | undefined;
  readonly tool?: { readonly resourceUri: string } | undefined;
  readonly externalOrigins?: ReadonlyArray<string> | undefined;
}): boolean | string {
  if (manifest.resource?.kind === "remote") {
    if (manifest.html !== undefined) return "Remote sandboxed app views cannot include HTML.";
  } else if (manifest.html === undefined) {
    return "Bundled sandboxed app views require inline HTML.";
  }
  if (manifest.tool !== undefined && manifest.tool.resourceUri !== manifest.resource?.uri) {
    return "Sandboxed app view tool and resource URIs must match.";
  }
  if (manifest.resource?.kind === "bundled" && !manifest.resource.uri.startsWith("ui://")) {
    return "Bundled sandboxed app views require a ui:// resource URI.";
  }
  if (manifest.resource?.kind === "remote" && !manifest.resource.uri.startsWith("https://")) {
    return "Remote sandboxed app views require an HTTPS resource URI.";
  }
  const origins = manifest.externalOrigins ?? [];
  if (
    origins.length > SANDBOXED_APP_VIEW_MAX_EXTERNAL_ORIGINS ||
    new Set(origins).size !== origins.length
  ) {
    return `Sandboxed app views allow at most ${SANDBOXED_APP_VIEW_MAX_EXTERNAL_ORIGINS} unique external origins.`;
  }
  return (
    new TextEncoder().encode(manifest.html ?? "").byteLength <= SANDBOXED_APP_VIEW_MAX_HTML_BYTES ||
    `Sandboxed app view HTML exceeds ${SANDBOXED_APP_VIEW_MAX_HTML_BYTES} bytes.`
  );
}

export const SandboxedAppViewManifest = Schema.Struct({
  ...AppViewManifestBase,
  kind: Schema.Literal("sandboxed"),
  /** Inline srcdoc payload. Optional only for remote resources hosted by an extension. */
  html: Schema.optional(Schema.String),
  resource: Schema.optional(SandboxedAppViewResource),
  /** Tool that advertised resource.uri through MCP Apps `_meta.ui.resourceUri`. */
  tool: Schema.optional(
    Schema.Struct({ name: TrimmedNonEmptyString, resourceUri: SandboxedAppViewResourceUri }),
  ),
  commandIds: Schema.Array(AppCommandId),
  externalOrigins: Schema.optional(Schema.Array(SandboxedAppViewExternalOrigin)),
}).check(Schema.makeFilter(validateSandboxedAppViewManifest));
export type SandboxedAppViewManifest = typeof SandboxedAppViewManifest.Type;

export const AppViewManifest = Schema.Union([NativeAppViewManifest, SandboxedAppViewManifest]);
export type AppViewManifest = typeof AppViewManifest.Type;

const ProjectAppViewManifestBase = {
  id: AppViewId,
  revision: AppViewRevision,
  title: TrimmedNonEmptyString,
  scope: Schema.Struct({ kind: Schema.Literal("project") }),
  placements: Schema.optionalKey(AppViewPlacements),
} as const;

export const ProjectNativeAppViewManifest = Schema.Struct({
  ...ProjectAppViewManifestBase,
  kind: Schema.Literal("native"),
  root: NativeAppViewNode,
}).check(Schema.makeFilter(validateNativeAppViewManifest));

export const ProjectSandboxedAppViewManifest = Schema.Struct({
  ...ProjectAppViewManifestBase,
  kind: Schema.Literal("sandboxed"),
  html: Schema.optional(Schema.String),
  resource: Schema.optional(SandboxedAppViewResource),
  tool: Schema.optional(
    Schema.Struct({ name: TrimmedNonEmptyString, resourceUri: SandboxedAppViewResourceUri }),
  ),
  commandIds: Schema.Array(AppCommandId),
  externalOrigins: Schema.optional(Schema.Array(SandboxedAppViewExternalOrigin)),
}).check(Schema.makeFilter(validateSandboxedAppViewManifest));

export const ProjectAppViewManifest = Schema.Union([
  ProjectNativeAppViewManifest,
  ProjectSandboxedAppViewManifest,
]);
export type ProjectAppViewManifest = typeof ProjectAppViewManifest.Type;

export function toProjectAppViewManifest(manifest: AppViewManifest): ProjectAppViewManifest {
  if (manifest.scope.kind !== "project") {
    throw new Error("Only project-scoped app views can be saved to t3.json.");
  }
  return { ...manifest, scope: { kind: "project" } };
}

export function bindProjectAppViewManifest(
  manifest: ProjectAppViewManifest,
  projectId: ProjectId,
): AppViewManifest {
  return { ...manifest, scope: { kind: "project", projectId } };
}

export const AppViewCreated = Schema.Struct({
  type: Schema.Literal("app-view.created"),
  manifest: AppViewManifest,
});
export type AppViewCreated = typeof AppViewCreated.Type;

export const AppViewUpdated = Schema.Struct({
  type: Schema.Literal("app-view.updated"),
  viewId: AppViewId,
  expectedRevision: AppViewRevision,
  manifest: AppViewManifest,
});
export type AppViewUpdated = typeof AppViewUpdated.Type;

export const AppViewRemoved = Schema.Struct({
  type: Schema.Literal("app-view.removed"),
  viewId: AppViewId,
});
export type AppViewRemoved = typeof AppViewRemoved.Type;

export const AppViewPinned = Schema.Struct({
  type: Schema.Literal("app-view.pinned"),
  viewId: AppViewId,
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("personal") }),
    Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  ]),
});
export type AppViewPinned = typeof AppViewPinned.Type;

export const AppViewUnpinned = Schema.Struct({
  type: Schema.Literal("app-view.unpinned"),
  viewId: AppViewId,
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("personal") }),
    Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  ]),
});
export type AppViewUnpinned = typeof AppViewUnpinned.Type;

export const AppViewDeleted = Schema.Struct({
  type: Schema.Literal("app-view.deleted"),
  viewId: AppViewId,
});
export type AppViewDeleted = typeof AppViewDeleted.Type;

/** A review-only proposal. Applying it is deliberately outside the view host. */
export const AppViewProjectPinProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  viewId: AppViewId,
  projectId: ProjectId,
  manifest: AppViewManifest,
  configPath: Schema.Literal("t3.json"),
  status: Schema.Literal("pending-review"),
});
export type AppViewProjectPinProposal = typeof AppViewProjectPinProposal.Type;

export const AppViewEvent = Schema.Union([
  AppViewCreated,
  AppViewUpdated,
  AppViewRemoved,
  AppViewPinned,
  AppViewUnpinned,
  AppViewDeleted,
]);
export type AppViewEvent = typeof AppViewEvent.Type;
