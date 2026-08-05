# App control plane

Status: accepted and implemented for this fork (2026-08-02).

This document is the architecture decision record and implementation ledger
for agent control, the environment assistant, generated views, and extensions.

T3 exposes a typed semantic control plane to coding agents. Codex, Claude,
Cursor, Grok, and OpenCode sessions receive the same authenticated `t3-code`
MCP surface and app-control principal derived from the thread, not the provider.
Agents discover
registered commands and invoke them with schema-validated arguments. They do
not drive T3 with DOM selectors, dispatch orchestration internals, or access
the database directly.

## Ownership

- Contracts define principals, descriptors, invocations, receipts, risks, and
  generated-view/extension models.
- The client-runtime registry owns command IDs, schemas, availability, risk,
  and execution ownership.
- Server-owned commands use orchestration services and persisted events.
  Client-owned commands use a focused-client lease.
- MCP is an authenticated adapter. It cannot expand principal scope or expose
  approval and user-input responses.
- Web and desktop host client commands and views. Mobile decodes contracts and
  omits unsupported controls.

The semantic catalog covers UI, project, thread, delegation, scripts,
terminal, source control, settings, and views. Existing web buttons, palette
entries, and keybindings use the same registry path where that action exists.
A missing web/desktop host does not block server-owned mutations.

## Safety and replay

Commands are observe, navigate, mutate, external, destructive, or forbidden.
Observe/navigation may run immediately. Mutations require a scoped grant. Raw
commands, publication, cloning, cross-environment actions, and destructive
actions require confirmation for every invocation. Destructive confirmation
is never remembered.

Confirmation content is derived by the server: exact target, environment,
descendant count where applicable, and recoverability. Agent prose never
becomes the label. Execution revalidates revision and arguments, uses action ID
for idempotency, writes sanitized audit activities, and resolves once.
Disconnect, interruption, session stop, and five-minute expiry cancel pending
work.

The server retains the newest 512 completed/declined action receipts. The web
host retains 256 client receipts. Active work is never evicted. Approval
responses, user-input responses, credentials, pairing, grant mutation, raw
orchestration dispatch, and direct database access are not discoverable.

## Global assistant and delegation

Each environment may own an immutable system project/assistant thread. The
drawer persists independently of project navigation. Codex runs from an
isolated home with a named control-only profile: explicit root/workspace/temp
denial, network disabled, and shell, approval, user-input, browser, apps,
plugins, memories, and multi-agent tools disabled. Startup fails unless Codex
reports the expected home, version, profile provenance, root deny, and network
deny.

Direct conversation, one-level delegation, origin metadata, a three-turn
concurrency limit, grant revocation, and stop controls are implemented. Target
project threads retain normal project permissions; the assistant never
inherits them. Proactive suggestion cards and mute controls are not yet
implemented.

## Generated views

Native views use a bounded declarative manifest: at most 200 nodes, depth 8,
and 256 KiB. They use theme tokens, explicit bindings, and registered commands;
there is no inline JavaScript, shell, arbitrary CSS, or evaluation. Thread and
personal views persist in client userdata. Project pinning creates a review-only
`t3.json` proposal and never writes tracked configuration silently.

The manifest may declare at most 12 bounded launcher placements across
`chat-topbar`, `project-sidebar`, and `right-panel-launcher`. Chrome placements
render only a label and allowlisted icon and open the full right-panel view.
Right-panel placements may append a tile or replace one visible built-in tile;
the add menu retains every built-in as the reverse path. Context merging is
deterministic: personal, then project, then thread, with narrower scope winning
for a stable view ID or conflicting replacement target. Durable project manifests omit the environment-local
project ID, which the client binds to the active project while loading `t3.json`.

Provider-neutral MCP tool descriptions define the phrases “add this to T4,”
“put this in T3,” and equivalent “the app” requests as generated UI intent.
Provider-specific system prompt support may reinforce that behavior, but is not
the authority or compatibility seam.

Rich views follow MCP Apps resource linkage and run in an iframe with
`sandbox="allow-scripts"` but no `allow-same-origin`. Inline HTML is capped at
2 MiB. Default CSP denies network, navigation, media, workers, forms, objects,
and frames. The audited bridge accepts only declared registered command IDs,
valid arguments, the current opaque-origin window/channel/revision, and one use
per request ID. Iframes mount lazily and are destroyed on close.

Remote resources and manifests requesting external origins stay blocked until
an origin-approval UI exists.

## Extensions and workspace providers

Installed extensions live in environment settings. Approval binds extension
identity, executable/arguments, and requested capabilities. Identity drift
disconnects the cached process and invalidates approval. Project manifests may
request an extension ID/config but cannot declare an auto-running command.

The host currently implements stdio MCP initialization, tools, resources, MCP
Apps metadata, and `t3.workspace-provider/v1`. Streamable HTTP contracts decode,
but the transport fails closed until redirect and origin enforcement exists.
There is not yet an end-user extension management screen.

Workspace providers remain authoritative. T3 caches only observed projections
with `observedAt` and computes staleness on read. Refresh is explicit and
event-driven; the host does not poll providers.

Lotus Runtime is optional under `integrations/lotus-runtime`; core T3 contains
no Lotus branches. The adapter invokes only installed `lotus ... --json` with
`shell: false`. Lotus owns worktrees, Docker, generated files, routes,
databases, and lifecycle. Existing and orphaned workspaces remain adoptable.

## Performance and remote behavior

Generated manifests, iframe bridge replay IDs, MCP messages, and action replay
caches are bounded. Updates are event-driven. There is no continuous model or
DOM polling and no new continuously repainting animation. Authenticated server
actions and confirmations work through the existing connection model for local,
relay, tunnel, web, and desktop clients.

## Known delivery gaps

- Confirmation uses the focused client's exact server-derived prompt; a
  dedicated assistant-drawer/activity card is not implemented.
- Proactive assistant suggestions are not implemented.
- Streamable HTTP extension transport is intentionally unavailable.
- Extension management and external-origin approval have no end-user UI.
- Lotus terminal/preview/URL handoffs are typed, but generic app-control
  execution for every handoff is incomplete.
- Mobile decodes contracts and hides unsupported controls; it does not host the
  assistant drawer or generated views.
- Integrated web/desktop certification remains a manual release step; see the
  operations runbook.
