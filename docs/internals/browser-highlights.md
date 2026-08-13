# Integrated browser highlights

Browser highlights travel through the existing typed preview automation path: MCP tool, server
broker, focused desktop host, renderer bridge, Electron IPC, then the preview manager. Current
desktop hosts advertise `highlightApply`, `highlightUpdate`, and `highlightClear`; these operations
are intentionally absent from the legacy V1 capability set.

`preview_highlight_apply` accepts one to twelve Playwright locators and returns an ephemeral
`highlightId`. Update and clear require that ID so an older request cannot replace or remove a newer
set on the same tab. Apply/update may center one numbered target and may return a viewport PNG. The
MCP adapter emits that PNG as image content and excludes its base64 bytes from structured content.

The preview manager resolves locators with the pinned Playwright injected runtime. It adds one
fixed, closed-shadow host to the guest document and never changes target element attributes,
classes, or styles. The host and every visual are pointer-transparent and out of flow. The host is
`aria-hidden` and inert; its shadow contains only non-interactive text and boxes. A manual popover
places the isolated host in Chromium's top layer so page dialogs cannot cover the callouts.

Geometry updates are event-driven. Captured scroll, resize, target resize, and DOM mutation signals
coalesce into one animation frame. There is no continuous repaint loop. Titles and explanations are
bounded contract strings inserted with `textContent`; colors come from a fixed enum.

Clear removes listeners, observers, queued animation work, and the host. A new document naturally
destroys all guest state, so clear after navigation or reload returns `cleared: false`. Highlights
are never reapplied across documents. Screenshot capture waits for two frames after optional scroll
and rendering so the returned viewport image includes settled callouts.
