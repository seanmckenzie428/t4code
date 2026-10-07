import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { useDesktopWorkspaceStore } from "./desktopWorkspaceStore";
import {
  readThreadPreviewState,
  updatePreviewServerSnapshot,
  type ThreadPreviewState,
} from "./previewStateStore";
import { useRightPanelStore } from "./rightPanelStore";

const restoring = new Map<string, Promise<void>>();

/** A backend restart replaces browser IDs. Keep workspace surface IDs and their layout stable. */
export async function reconcileDesktopBrowsers(
  ref: ScopedThreadRef,
  state: Pick<ThreadPreviewState, "sessions" | "serverEpoch" | "listServerEpoch">,
  open: (snapshot: PreviewSessionSnapshot) => Promise<PreviewSessionSnapshot>,
  close: (tabId: string) => Promise<unknown>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  const epoch = state.serverEpoch;
  if (!epoch || state.listServerEpoch !== epoch) return;
  const key = scopedThreadKey(ref);
  const surfaces = useRightPanelStore.getState().byThreadKey[key]?.surfaces ?? [];
  const pending: Promise<void>[] = [];
  for (const surface of surfaces) {
    if (surface.kind !== "preview" || !surface.resourceId) continue;
    const snapshot = state.sessions[surface.resourceId];
    if (snapshot) {
      useDesktopWorkspaceStore.getState().rememberBrowser(ref, surface.id, epoch, snapshot);
      continue;
    }
    const saved =
      useDesktopWorkspaceStore.getState().byThreadKey[key]?.browserSessions?.[surface.id];
    if (!saved || saved.epoch === epoch) continue;
    const restoreKey = `${key}:${surface.id}:${epoch}`;
    const existing = restoring.get(restoreKey);
    if (existing) {
      pending.push(existing);
      continue;
    }
    const operation = (async () => {
      try {
        const restored = await open(saved.snapshot);
        const current = useRightPanelStore
          .getState()
          .byThreadKey[key]?.surfaces.find((entry) => entry.id === surface.id);
        if (
          current?.kind !== "preview" ||
          current.resourceId !== surface.resourceId ||
          readThreadPreviewState(ref).serverEpoch !== epoch
        ) {
          await close(restored.tabId);
          return;
        }
        useRightPanelStore.getState().restoreBrowser(ref, surface.id, restored.tabId);
        useDesktopWorkspaceStore.getState().rememberBrowser(ref, surface.id, epoch, restored);
        updatePreviewServerSnapshot(ref, restored);
      } catch (error) {
        // Leave a recoverable launcher rather than a tab pointing at a dead session.
        useRightPanelStore.getState().closeSurface(ref, surface.id);
        onFailure(error);
      } finally {
        restoring.delete(restoreKey);
      }
    })();
    restoring.set(restoreKey, operation);
    pending.push(operation);
  }
  if (pending.length) {
    await Promise.all(pending);
    return;
  }
  useRightPanelStore.getState().reconcileBrowserSurfaces(ref, Object.keys(state.sessions));
}
