# T4 Code

T4 Code is Sean McKenzie's personal fork of [T3 Code](https://github.com/pingdotgg/t3code), an open-source control surface for coding agents. It runs Claude Code, Codex, Cursor, Grok Build, and OpenCode through web, desktop, and mobile clients.

The fork keeps T3's internal package names, state paths, protocols, and other compatibility identifiers so existing data keeps working and upstream changes remain mergeable. See [T4 compatibility identifiers](./docs/internals/t4-compatibility.md).

## Current distribution status

T4 Code is currently source-only. There are no T4 npm packages, hosted web app, signed desktop releases, mobile-store builds, or auto-update feeds. Official T3 downloads are not T4 releases.

The local source build exposes `t4` as the canonical CLI and retains `t3` as a compatibility alias. The published npm package is still named `t3`; do not publish it as T4.

## Build locally

Install and authenticate at least one supported provider, then install the repository dependencies:

```bash
vp i
vp run dev
```

The dev runner prints the local URL and pairing token. Use the pairing URL it provides.

For a built local CLI:

```bash
vp run --filter t3 build
./apps/server/dist/bin.mjs --help
```

The binary reports T4 branding. Package-manager installation remains deferred until independent T4 distribution infrastructure exists.

## Documentation

- [Documentation index](./docs)
- [Architecture overview](./docs/internals/overview.md)
- [Compatibility identifiers](./docs/internals/t4-compatibility.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access](./docs/user/remote-access.md)

## Upstream and repository layout

- Personal fork: `https://github.com/seanmckenzie428/t4`
- Upstream: `https://github.com/pingdotgg/t3code`
- Keep the local `upstream` Git remote pointed at `pingdotgg/t3code`.

Internal workspace package names remain `@t3tools/*`. T4 branding is display-layer branding, not a wire-format or persisted-data migration.

## Contributing

Install the Vite+ `vp` command from [vite.plus](https://vite.plus), run `vp i`, and read [CONTRIBUTING.md](./CONTRIBUTING.md). Changes intended for upstream should follow upstream T3 Code's contribution policy.

T3 Code and its historical materials remain attributed to their original authors under the repository's MIT license.
