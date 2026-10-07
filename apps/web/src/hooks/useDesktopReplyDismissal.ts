import { useEffect } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { desktopWorkspaceLayout, useDesktopWorkspaceStore } from "../desktopWorkspaceStore";

/** Seeing a split conversation leaves the reply available when returning to floating Chat. */
export function useDesktopReplyDismissal(
  ref: ScopedThreadRef | null,
  messageId: string | null,
  layout: ReturnType<typeof desktopWorkspaceLayout>,
  sending: boolean,
) {
  const environmentId = ref?.environmentId;
  const threadId = ref?.threadId;
  useEffect(() => {
    if (!environmentId || !threadId || !messageId) return;
    if (layout.activeTab === "chat" || sending)
      useDesktopWorkspaceStore.getState().dismissReply({ environmentId, threadId }, messageId);
  }, [environmentId, threadId, messageId, layout.activeTab, sending]);
}
