import { useEffectEvent, useLayoutEffect } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import { useDesktopWorkspaceStore, type DesktopTabId } from "../desktopWorkspaceStore";

/** Apply the content-tab default on entry, without overriding a manual show/hide afterward. */
export function useDesktopComposerVisibility(
  ref: ScopedThreadRef | null,
  tab: DesktopTabId,
  draftTarget: ComposerThreadTarget,
  hasRetainedAttachments = false,
) {
  const environmentId = ref?.environmentId;
  const threadId = ref?.threadId;
  const draftId = typeof draftTarget === "string" ? draftTarget : null;
  const draftEnvironmentId = typeof draftTarget === "string" ? null : draftTarget.environmentId;
  const draftThreadId = typeof draftTarget === "string" ? null : draftTarget.threadId;
  const hasDraft = useEffectEvent(
    (target: ComposerThreadTarget) =>
      hasRetainedAttachments ||
      composerDraftHasUserContent(useComposerDraftStore.getState().getComposerDraft(target)),
  );
  useLayoutEffect(() => {
    if (!environmentId || !threadId || tab === "chat") return;
    const target =
      draftId ??
      (draftEnvironmentId && draftThreadId
        ? { environmentId: draftEnvironmentId, threadId: draftThreadId }
        : null);
    if (!target) return;
    useDesktopWorkspaceStore
      .getState()
      .setCollapsed({ environmentId, threadId }, !hasDraft(target));
  }, [environmentId, threadId, tab, draftId, draftEnvironmentId, draftThreadId]);
}

/** Full Chat keeps its editor; content views toggle between visible Chat and its pill. */
export function toggleDesktopComposer(ref: ScopedThreadRef, tab: DesktopTabId) {
  if (tab === "chat") return "composer";
  const store = useDesktopWorkspaceStore.getState();
  const current = store.byThreadKey[scopedThreadKey(ref)];
  if (!current) return "composer";
  if (current.splitTabs[tab]) {
    store.toggleSplit(ref);
    store.setCollapsed(ref, true);
    return "content";
  }
  store.setCollapsed(ref, !current.composerCollapsed);
  return current.composerCollapsed ? "composer" : "content";
}
