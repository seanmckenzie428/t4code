# Agent app control

This fork exposes a semantic T3 control plane to Codex. The agent discovers typed commands and
invokes them by command ID; it does not click or inspect T3's own DOM.

Quick Chat opens from its floating button, the command palette, or `mod+shift+space`. It stays
outside projects and the sidebar. Press Escape to save and close it; saved conversations live in
**Settings** → **Archived** → **Quick Chat history**.

Quick Chat requires an explicit Codex model selection. It refuses to start when the installed
Codex runtime cannot prove enforcement of the control-only filesystem and network profile.

Agents can present generated views in the thread's right panel. Native views use bounded T3
components and registered actions. Rich views run in an opaque-origin iframe with a default-deny
content security policy and can call only command IDs declared by that view. External origins are
blocked until separately approved.

Destructive and publication commands do not execute without a per-call human confirmation host.
Approval responses, user-input responses, credentials, pairing, grant changes, raw internal
dispatch, and database access are never exposed as agent commands.

Views can stay with a thread or be pinned personally. Project pins are review
proposals; T3 never silently changes project configuration.

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
