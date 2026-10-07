import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { isElectron } from "../env";
import { desktopSurfaceId, useDesktopWorkspaceStore } from "../desktopWorkspaceStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";

export function desktopPreviewSelected(ref: ScopedThreadRef | null): boolean {
  const workspace = ref
    ? useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]
    : undefined;
  return workspace !== undefined && (desktopSurfaceId(workspace)?.startsWith("browser:") ?? false);
}

/** Shortcut contexts follow desktop placement, not the retained web panel state. */
export function usePreviewOpen(ref: ScopedThreadRef | null): boolean {
  const desktopOpen = useDesktopWorkspaceStore((state) => {
    const workspace = ref ? state.byThreadKey[scopedThreadKey(ref)] : undefined;
    return (
      workspace !== undefined && (desktopSurfaceId(workspace)?.startsWith("browser:") ?? false)
    );
  });
  const panelOpen = useRightPanelStore((state) =>
    ref ? selectActiveRightPanel(state.byThreadKey, ref) === "preview" : false,
  );
  return isElectron ? desktopOpen : panelOpen;
}
