# T4 compatibility identifiers

T4 Code is a personal fork of T3 Code. Its display branding and local canonical CLI changed, but persisted, protocol, operating-system, and upstream-facing identifiers did not.

Keep these identifiers unchanged unless a separate migration is designed and shipped:

- Internal packages: `@t3tools/*`
- Production npm package: `t3`
- Environment variables: `T3CODE_*`
- State paths: `~/.t3` and worktree `.t3`
- Storage keys beginning with `t3code`
- Desktop and mobile schemes: `t3code*`
- Bundle/package IDs: `com.t3tools.t3code*`
- EAS project, App Store ID, app groups, signing IDs, and update URL
- Linux service: `t3code.service`
- MCP server ID: `t3-code`
- Wire/auth identifiers including `urn:t3:*`, `t3-env:*`, JWT types, and relay client IDs
- Relay, database, tunnel, telemetry dataset, and physical resource names
- Configuration files and schemas: `t3.json`, `.t3code/vcs.json`, and the existing T3 schema URL

These names are compatibility contracts, not missed branding. Existing state must open without migration, existing `t3code://` links must continue to work, and upstream merges must not require renaming `@t3tools/*` imports.

Visible product copy should use **T4 Code** and **T4 Connect**. Local builds expose `t4` as the canonical CLI while retaining `t3` as an alias. Release installation, self-update, SSH package installation, and systemd infrastructure remain on package/service name `t3` until independent T4 distribution exists.

The existing release workflow is guarded to run only in `pingdotgg/t3code`; it must not publish from the personal fork. Marketing legal-policy drafts remain unlinked and must not be deployed as T4 policies until operator identity, privacy contacts, and distribution URLs are ready.

Repository attribution is also intentional:

- Personal fork: `seanmckenzie428/t4`
- Upstream: `pingdotgg/t3code`

Historical testimonials, changelogs, quotes, and contribution history should retain T3 wording.
