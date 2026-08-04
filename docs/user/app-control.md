# Agent app control

This fork exposes a semantic T3 control plane to Codex. The agent discovers typed commands and
invokes them by command ID; it does not click or inspect T3's own DOM.

The persistent T3 Assistant drawer opens from the bot button, the command palette, or
`mod+shift+a`. Its open state is remembered per environment and survives project navigation. On
small windows it opens as an overlay.

The assistant is disabled until an environment has an explicit Codex model selection. This build
also refuses to start the assistant when the installed Codex runtime cannot prove enforcement of
the control-only filesystem and network profile. The drawer explains that refusal instead of
starting with prompt-only restrictions.

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

Current limitations: proactive assistant suggestions are unavailable, remote
rich-view resources and external origins stay blocked, and mobile hides the
assistant and generated-view controls.
