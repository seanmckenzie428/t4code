# Agent app control

This fork exposes a semantic T3 control plane to supported providers, including Codex, Claude,
Cursor, Grok, and OpenCode. The agent discovers typed commands and invokes them by command ID; it
does not click or inspect T3's own DOM.

When you ask an agent to “add this to T4,” “put this in T3,” or “show this in the app” while
describing a view, dashboard, control, or interactive tool, the shared app tools identify that as a
generated in-app UI request. This meaning comes from the provider-neutral T3 MCP surface rather
than one provider's prompt.

Quick Chat opens from its floating button, the command palette, or `mod+shift+space`. It stays
outside projects and the sidebar. Press Escape to save and close it; saved conversations live in
**Settings** → **Archived** → **Quick Chat history**.

Quick Chat requires an explicit Codex model selection. It refuses to start when the installed
Codex runtime cannot prove enforcement of the control-only filesystem and network profile.
Its T4 controls remain available when agent browser access is disabled; that setting controls
browser tools only.

Regular project chats can inspect and control any project or thread in the same environment. They
can create a thread or start delegated work in another existing thread while you continue in the
current chat when **Settings** → **Quick Chat** → **Chat delegation** is enabled. Delegated threads
cannot delegate again, and no chat can control another environment.

Agents can present generated views in the thread's right panel. Native views use bounded T3
components and registered actions. Rich views run in an opaque-origin iframe with a default-deny
content security policy and can call only command IDs declared by that view. External origins are
blocked until separately approved.

Generated views may also add compact launchers to the chat top bar, the active project's sidebar,
and the right-panel launcher grid. A right-panel launcher may replace a visible built-in tile, but
the built-in surface remains available from the panel's add menu. Launchers use native T3 controls.
They can open the full generated view, an approved HTTP(S) URL in the system browser, or a URL in
T3's dedicated browser; they do not inject arbitrary code into app chrome.

The dedicated browser is also available from Global Search and opens with `mod+shift+b`.
Agents can add ephemeral numbered explanations to pages in that browser; see
[Browser highlights](browser-highlights.md).

Destructive and publication commands do not execute without a per-call human confirmation host.
Approval responses, user-input responses, credentials, pairing, grant changes, raw internal
dispatch, and database access are never exposed as agent commands.

Views can stay with a thread or be saved personally for that environment. Thread launchers are
temporary. Personal launchers appear throughout that environment. Generated views never write
project configuration. Hand-authored project views remain readable from checked-in `t3.json`, and
changing them requires an explicit file edit.

Extensions are environment-local and disabled until their exact executable,
arguments, transport, and capabilities are approved. Changing those details
invalidates approval. This build supports local stdio extensions; remote HTTP
extensions remain disabled. Extension management and external network approval
do not yet have a settings screen.

Lotus Runtime support is optional. Installing or removing it does not change
core T3 behavior. Lotus remains responsible for its worktrees, containers,
routes, databases, and lifecycle. T3 marks observed runtime state as stale when
appropriate.

Current limitations: proactive Quick Chat suggestions are unavailable, remote
rich-view resources and external origins stay blocked, and mobile hides the
Quick Chat and generated-view controls.
