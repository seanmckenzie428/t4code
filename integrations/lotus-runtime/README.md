# Lotus Runtime extension

Optional T3 extension for workspaces owned by the standalone `lotus` CLI. Core T3 has no Lotus-specific branches; this package communicates with the generic MCP extension host over stdio and advertises `t3.workspace-provider/v1`.

## Install

Build or install this package so `t3-lotus-runtime-extension` is on the T3 server host's `PATH`, then add the contents of `extension.json` to the environment's installed extension settings. T3 shows the exact executable, arguments, transport, and requested capabilities before enablement. A changed executable or argument hash requires approval again.

The current extension host has no end-user install/settings screen. Installation is therefore a settings-level operation until that generic UI lands; the package itself is independently buildable, runnable, disableable, and removable.

To remove it, disable the `lotus-runtime` extension first so T3 disconnects the
exact child process, then remove its installed-extension settings entry and the
`t3-lotus-runtime-extension` executable/package. Existing T3 projects and
threads remain usable; workspace bindings become visibly unavailable until the
extension is installed again. Removal never asks Lotus Runtime to stop or trash
its workspaces.

The extension never reads Lotus Runtime state files and never invokes Docker directly. It executes only the installed `lotus` executable with an argument array and `shell: false`. Runtime JSON is bounded to 2 MiB. Stderr is consumed but never returned to MCP clients because it may contain sensitive diagnostics.

## Workspace mapping

- Lotus slug becomes the external workspace ID.
- `worktree_path` becomes the T3 execution root.
- Branch, health, checks, drift, commands, warnings, and URLs populate cockpit metadata.
- Binding is `{ extensionId: "lotus-runtime", providerId: "lotus", workspaceId: slug }`.
- Every observed workspace is adoptable, including a runtime workspace left behind if later T3 thread creation fails.
- Created/adopted workspaces carry `skipNativeBootstrap: true`; Lotus Runtime remains owner of Docker, generated files, routing, databases, and lifecycle.
- This extension never auto-trashes a workspace after a downstream T3 failure.

## Command policy

Reads shell to `status`, `list`, `explain`, and `todo list` with `--json`. Lifecycle actions use `create`, `resume`, `down`, and `recreate`. Destructive actions are declared with `risk: "destructive"` so T3 must hard-confirm every call:

- `fresh-db`
- `clone-db <slug> --source <source> --replace`
- `trash`

The extension does not expose approval-response, user-input-response, credential, raw-shell, or arbitrary command tools. Operation IDs are idempotent for the extension process lifetime and produce typed completion/failure receipts.

Logs and URLs return bounded client handoffs rather than opening local applications from the server process. Logs request a visible T3 terminal with exact `lotus logs ...` argv. Dashboard requests T3 preview; admin, API, storefront, and mail request an authenticated client URL open. Generic app-control wiring must authorize and execute those handoffs; the extension cannot access the client DOM or websocket directly.
