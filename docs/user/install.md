# Run T4 Code locally

T4 Code is a web and desktop GUI for running coding agents. This personal fork is currently distributed from source only.

## Requirements

- Node.js `^22.16 || ^23.11 || >=24.10`
- The Vite+ `vp` command
- At least one installed and authenticated provider CLI

## Start from source

From the repository:

```bash
vp i
vp run dev
```

The dev runner prints a local pairing URL. Open that URL rather than the bare origin.

There is no T4 npm package, signed desktop release, hosted web app, mobile-store build, or package-manager formula yet. `npx t3`, official T3 desktop releases, `winget`, Homebrew, and AUR entries install upstream T3 Code, not T4 Code.

Local server builds expose `t4` as the canonical executable and retain `t3` as a compatibility alias. Published-package installation, SSH bootstrap, self-update, and the Linux service continue to use package/service name `t3` until independent T4 distribution exists.

## Providers

T4 Code drives provider CLIs; it does not ship them.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Run login commands on the machine running the T4 Code server. Each provider binary must be on that server's `PATH`, or configured through **Settings** → provider → **Binary path**.

Provider authentication is required before starting a session with that provider, not before starting T4 Code.

## Next steps

- [Compatibility identifiers](../internals/t4-compatibility.md)
- [Permission modes](./permission-modes.md)
- [Remote access](./remote-access.md)
- [Source control integrations](./source-control.md)
