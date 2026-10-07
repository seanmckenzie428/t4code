import { useEffectEvent, useLayoutEffect } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import { useDesktopWorkspaceStore, type DesktopTabId } from "../desktopWorkspaceStore";

/** Apply the content-tab default; new review comments reveal their added composer context. */
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
    let comments = useComposerDraftStore.getState().getComposerDraft(target)?.reviewComments;
    return useComposerDraftStore.subscribe((state) => {
      const next = state.getComposerDraft(target)?.reviewComments;
      const added =
        next !== comments &&
        next?.some((comment) => !comments?.some(({ id }) => id === comment.id));
      comments = next;
      if (added) {
        useDesktopWorkspaceStore.getState().setCollapsed({ environmentId, threadId }, false);
      }
    });
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
