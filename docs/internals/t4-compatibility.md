# Pilot compatibility identifiers

Pilot (formerly T4 Code) is a personal fork of T3 Code. Display branding changed; existing CLI aliases, persisted data, protocols, operating-system identities, and upstream-facing identifiers stay compatible.

Keep these identifiers unchanged unless a separate migration is designed and shipped:

- Internal packages: `@t3tools/*`
- Production npm package: `t3`
- Environment variables: `T3CODE_*` and `T4CODE_DESKTOP_LOCAL_SIGNING_IDENTITY`
- Local signing configuration: `t4.desktopNightlySigningIdentity`
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

Visible product copy should use **Pilot** and **Pilot Connect**. Local builds expose `t4` as the canonical CLI while retaining `t3` as an alias. Release installation, self-update, SSH package installation, and systemd infrastructure remain on package/service name `t3` until independent Pilot distribution exists.

The existing release workflow is guarded to run only in `pingdotgg/t3code`; it must not publish from the personal fork. Marketing legal-policy drafts remain unlinked and must not be deployed as Pilot policies until operator identity, privacy contacts, and distribution URLs are ready.

Repository attribution is also intentional:

- Personal fork: `seanmckenzie428/t4code`
- Upstream: `pingdotgg/t3code`

Historical testimonials, changelogs, quotes, and contribution history should retain T3 wording.

Behavioral fork invariants and the required T3 integration procedure live in
[`t4-fork-invariants.md`](./t4-fork-invariants.md).
