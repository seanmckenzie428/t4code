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

Agents can present generated views in the thread's right panel. Native views use bounded T3
components and registered actions. Rich views run in an opaque-origin iframe with a default-deny
content security policy and can call only command IDs declared by that view. External origins are
blocked until separately approved.

Generated views may also add compact launchers to the chat top bar, the active project's sidebar,
and the right-panel launcher grid. A right-panel launcher may replace a visible built-in tile, but
the built-in surface remains available from the panel's add menu. Launchers open the full generated
view; they do not inject arbitrary code into app chrome.

Destructive and publication commands do not execute without a per-call human confirmation host.
Approval responses, user-input responses, credentials, pairing, grant changes, raw internal
dispatch, and database access are never exposed as agent commands.

Views can stay with a thread, be saved personally for that environment, or be saved to the project.
Thread launchers are temporary. Personal and project launchers appear wherever that environment or
project is active. Project saves remain review proposals, and the checked-in `t3.json` stores a
portable project scope rather than an environment-local project ID. T3 never silently changes
project configuration.

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
