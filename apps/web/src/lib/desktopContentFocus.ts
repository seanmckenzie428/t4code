/** Hosted websites live outside their content slot so tab switches retain their sessions. */
export function focusDesktopContent() {
  const content = document.querySelector<HTMLElement>("[data-desktop-main-content]");
  const browser =
    content?.getAttribute("data-preview-panel-mode") === "main"
      ? document.querySelector<HTMLElement>('webview[data-preview-tab]:not([aria-hidden="true"])')
      : null;
  (browser ?? content)?.focus();
}
