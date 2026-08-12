import { isPreviewFocused } from "./previewFocus";

// PreviewPanelShell owns every thread-scoped right-panel surface. Keep the
// broader keybinding name without duplicating its focus and webview handling.
export const isRightPanelFocused = isPreviewFocused;
