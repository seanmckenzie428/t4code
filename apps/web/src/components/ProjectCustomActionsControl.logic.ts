import type { ProjectCustomAction } from "@t3tools/contracts";

export function setProjectCustomActionPlacement(
  actions: ReadonlyArray<ProjectCustomAction>,
  actionId: string,
  placement: "menu" | "toolbar",
): ReadonlyArray<ProjectCustomAction> | null {
  if (!actions.some((action) => action.id === actionId)) return null;
  return actions.map((action) => (action.id === actionId ? { ...action, placement } : action));
}

export function deleteProjectCustomAction(
  actions: ReadonlyArray<ProjectCustomAction>,
  actionId: string,
): ReadonlyArray<ProjectCustomAction> {
  return actions.filter((action) => action.id !== actionId);
}

export function projectCustomActionPresentation(actions: ReadonlyArray<ProjectCustomAction>): {
  readonly menu: ReadonlyArray<ProjectCustomAction>;
  readonly toolbar: ReadonlyArray<ProjectCustomAction>;
} {
  return {
    // Pinned actions remain manageable in the menu.
    menu: actions,
    toolbar: actions.filter((action) => action.placement === "toolbar"),
  };
}
