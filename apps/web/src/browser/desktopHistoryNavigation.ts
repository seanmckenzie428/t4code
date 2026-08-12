import { readPreviewHistoryHover, type PreviewHistoryHoverTarget } from "./previewHistoryHover";
import type { HistoryGestureDirection } from "@t3tools/shared/historyGesture";

export const DESKTOP_HISTORY_BACK_ACTION = "history-back";
export const DESKTOP_HISTORY_FORWARD_ACTION = "history-forward";

export type DesktopHistoryAction =
  | typeof DESKTOP_HISTORY_BACK_ACTION
  | typeof DESKTOP_HISTORY_FORWARD_ACTION;

interface PreviewHistoryBridge {
  readonly goBack: (runtimeTabId: string) => Promise<unknown>;
  readonly goForward: (runtimeTabId: string) => Promise<unknown>;
}

interface AppHistory {
  readonly back: () => void;
  readonly forward: () => void;
}

export function isDesktopHistoryAction(action: string): action is DesktopHistoryAction {
  return action === DESKTOP_HISTORY_BACK_ACTION || action === DESKTOP_HISTORY_FORWARD_ACTION;
}

export function desktopHistoryActionFromDirection(
  direction: HistoryGestureDirection,
): DesktopHistoryAction {
  return direction === "back" ? DESKTOP_HISTORY_BACK_ACTION : DESKTOP_HISTORY_FORWARD_ACTION;
}

export async function routeDesktopHistoryAction(input: {
  readonly action: DesktopHistoryAction;
  readonly hoveredPreview: PreviewHistoryHoverTarget | null;
  readonly previewBridge: PreviewHistoryBridge | null;
  readonly appHistory: AppHistory;
}): Promise<void> {
  const { action, hoveredPreview, previewBridge, appHistory } = input;
  if (hoveredPreview !== null) {
    const runtimeTabId = hoveredPreview.runtimeTabId;
    if (!runtimeTabId || !previewBridge) return;
    if (action === DESKTOP_HISTORY_BACK_ACTION) {
      await previewBridge.goBack(runtimeTabId);
    } else {
      await previewBridge.goForward(runtimeTabId);
    }
    return;
  }

  if (action === DESKTOP_HISTORY_BACK_ACTION) {
    appHistory.back();
  } else {
    appHistory.forward();
  }
}

export function handleDesktopHistoryAction(action: DesktopHistoryAction): Promise<void> {
  return routeDesktopHistoryAction({
    action,
    hoveredPreview: readPreviewHistoryHover(),
    previewBridge: window.desktopBridge?.preview ?? null,
    appHistory: window.history,
  });
}
