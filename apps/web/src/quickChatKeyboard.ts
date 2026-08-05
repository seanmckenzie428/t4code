export function isQuickChatCloseEvent(
  event: Pick<KeyboardEvent, "defaultPrevented" | "key">,
  isOpen: boolean,
): boolean {
  return isOpen && !event.defaultPrevented && event.key === "Escape";
}
