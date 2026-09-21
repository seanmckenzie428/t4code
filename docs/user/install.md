# Run T4 Code locally

T4 Code is a web and desktop GUI for running coding agents. This personal fork is currently distributed from source only.

## Requirements

- Node.js `^24.13.1`
- The Vite+ `vp` command
- At least one installed and authenticated provider

## Start from source

From the repository:

```bash
vp i
vp run dev
```

The dev runner prints a local pairing URL. Open that URL rather than the bare origin.

There is no T4 npm package, signed desktop release, hosted web app, mobile-store build, or package-manager formula yet. `npx t3`, official T3 desktop releases, `winget`, Homebrew, and AUR entries install upstream T3 Code, not T4 Code.

Local server builds expose `t4` as the canonical executable and retain `t3` as a compatibility alias. Published-package installation, SSH bootstrap, self-update, and the Linux service continue to use package/service name `t3` until independent T4 distribution exists.

## Open a project from a terminal

With the local desktop app running, use `t4 app` to open the current directory, or
`t4 app ../my-project` for another directory. The app adds the project if needed.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                        |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Install and sign in with Google from T4 Code's provider settings.                            |

Provider CLIs must be on the server's `PATH`. If T4 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when T4 Code can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T4 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T4 Code](./updating.md): update the app and connected servers.
