import { isElectron } from "../env";
import { isPreviewFocused } from "./previewFocus";

export function isRightPanelFocused(): boolean {
  return (
    isPreviewFocused() ||
    (isElectron &&
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest("[data-right-panel-root]") !== null)
  );
}
