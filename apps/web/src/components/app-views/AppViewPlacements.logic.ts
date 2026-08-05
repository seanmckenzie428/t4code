import type {
  AppViewManifest,
  AppViewPlacement,
  AppViewPlacementAction,
  AppViewPlacementSlot,
  AppViewRightPanelLauncherTarget,
} from "@t3tools/contracts";

export interface ResolvedAppViewPlacement {
  readonly id: string;
  readonly manifest: AppViewManifest;
  readonly placement: AppViewPlacement;
  readonly label: string;
  readonly description: string;
}

export function activateAppViewPlacement(
  item: ResolvedAppViewPlacement,
  handlers: {
    readonly openView: (manifest: AppViewManifest) => void;
    readonly runAction: (action: AppViewPlacementAction) => void;
  },
): void {
  if (item.placement.action) {
    handlers.runAction(item.placement.action);
    return;
  }
  handlers.openView(item.manifest);
}

export function mergeContextAppViews(input: {
  readonly personal: Readonly<Record<string, AppViewManifest>>;
  readonly project: ReadonlyArray<AppViewManifest>;
  readonly thread: Readonly<Record<string, AppViewManifest>>;
}): ReadonlyArray<AppViewManifest> {
  const manifests = new Map<string, AppViewManifest>();
  for (const manifest of Object.values(input.personal)) manifests.set(manifest.id, manifest);
  for (const manifest of input.project) manifests.set(manifest.id, manifest);
  for (const manifest of Object.values(input.thread)) manifests.set(manifest.id, manifest);
  return [...manifests.values()];
}

export function resolveAppViewPlacements(
  manifests: ReadonlyArray<AppViewManifest>,
  slot: AppViewPlacementSlot,
): ReadonlyArray<ResolvedAppViewPlacement> {
  return manifests
    .flatMap((manifest) =>
      (manifest.placements ?? []).flatMap((placement, index) =>
        placement.slot === slot
          ? [
              {
                id: `${manifest.id}:${slot}:${index}`,
                manifest,
                placement,
                label: placement.label ?? manifest.title,
                description: placement.description ?? `Open ${placement.label ?? manifest.title}.`,
              },
            ]
          : [],
      ),
    )
    .sort(
      (left, right) =>
        (left.placement.order ?? 0) - (right.placement.order ?? 0) ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
}

function scopePriority(manifest: AppViewManifest): number {
  if (manifest.scope.kind === "thread") return 2;
  if (manifest.scope.kind === "project") return 1;
  return 0;
}

export function partitionRightPanelAppViewPlacements(
  placements: ReadonlyArray<ResolvedAppViewPlacement>,
): {
  readonly replacements: ReadonlyMap<AppViewRightPanelLauncherTarget, ResolvedAppViewPlacement>;
  readonly appended: ReadonlyArray<ResolvedAppViewPlacement>;
} {
  const replacements = new Map<AppViewRightPanelLauncherTarget, ResolvedAppViewPlacement>();
  const appended: Array<ResolvedAppViewPlacement> = [];
  for (const item of placements) {
    if (item.placement.mode !== "replace" || !item.placement.targetId) {
      appended.push(item);
      continue;
    }
    const current = replacements.get(item.placement.targetId);
    if (!current || scopePriority(item.manifest) >= scopePriority(current.manifest)) {
      replacements.set(item.placement.targetId, item);
    }
  }
  return { replacements, appended };
}
