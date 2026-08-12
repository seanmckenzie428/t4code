export const START_PICK_CHANNEL = "preview:start-pick";
export const CANCEL_PICK_CHANNEL = "preview:cancel-pick";
export const ELEMENT_PICKED_CHANNEL = "preview:element-picked";
export const ANNOTATION_CAPTURED_CHANNEL = "preview:annotation-captured";
export const ANNOTATION_THEME_CHANNEL = "preview:annotation-theme";
export const HUMAN_INPUT_CHANNEL = "preview:human-input";
export const HISTORY_NAVIGATION_CHANNEL = "preview:history-navigation";

export type PreviewHistoryNavigationDirection = "back" | "forward";

export function isPreviewHistoryNavigationDirection(
  value: unknown,
): value is PreviewHistoryNavigationDirection {
  return value === "back" || value === "forward";
}
