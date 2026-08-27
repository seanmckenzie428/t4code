# T4 fork invariants

T4 is a long-lived fork of T3, not a temporary patch stack. Upstream work is welcome only when it
preserves T4 behavior. Git conflict resolution is insufficient: independently added code paths can
merge cleanly while omitting a required T4 field or bypassing a T4 policy.

## Precedence

- T4 behavior wins by default.
- Preserve compatible upstream improvements alongside T4 behavior.
- Never accept an upstream file wholesale, use blanket `-X theirs`, renumber shipped T4
  migrations, remove a T4 test to make upstream pass, or silently replace a T4 workflow.
- If both behaviors cannot coexist, stop before committing and ask the user which takes precedence.
- Treat every shared path as a semantic conflict even when Git reports no textual conflict.

## Current T4 behavior inventory

| Area                          | T4 invariant                                                                                                                                                                                                                                                                  | Main protection                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Branding and distribution     | Visible product is T4 Code/T4 Connect; `t4` is canonical local CLI and `t3` remains compatibility alias; upstream publishing stays disabled; personal `origin` is push target and T3 `upstream` is fetch-only.                                                                | `packages/shared/src/branding.test.ts`, `apps/web/src/branding.test.ts`, `apps/desktop/src/app/DesktopAppIdentity.test.ts`, release smoke tests |
| Compatibility identifiers     | Persisted, protocol, package, service, scheme, bundle, state, relay, and configuration identifiers listed in `t4-compatibility.md` stay T3-compatible.                                                                                                                        | `docs/internals/t4-compatibility.md`, compatibility and auth tests                                                                              |
| App control                   | Agents use a provider-neutral, typed, policy-checked command surface with audits, grants, client invocation, bounded destructive actions, and no raw DB/credential access.                                                                                                    | `AppControlPolicy.test.ts`, `AppControlServerExecutor.test.ts`, app-control contract tests                                                      |
| Quick Chat and delegation     | Environment Quick Chat remains outside projects, uses its system entities/control-only profile, supports bounded project delegation, and preserves delegation origin on projected messages.                                                                                   | `QuickChat.test.ts`, `decider.systemEntities.test.ts`, `ProjectionSnapshotQuery.test.ts`                                                        |
| Generated views               | Native/sandboxed views, bounded launcher placements, URL actions, management controls, and chat-topbar split buttons remain supported. Generated writes are machine-local/personal; project `t3.json` is hand-authored and read-only to generated UI.                         | `appViews.test.ts`, `appViewCommandHost.test.ts`, `AppViewPlacements.logic.test.ts`, `GeneratedViewLibrary.logic.test.ts`                       |
| Active-worktree project views | Project launchers resolve the active thread worktree first, wait for that query, then fall back to project root only when worktree `t3.json` is absent. Lotus-local launcher URLs bind to the active thread's Lotus workspace instead of a stack hardcoded in project config. | `useT3ProjectFileAppViews.test.ts`                                                                                                              |
| Main review workflow          | Review lives in main view with full diff navigation; clearing Viewed also expands the file.                                                                                                                                                                                   | review service, main-view, diff rail, and `diffCollapse.test.ts`                                                                                |
| Workspace preferences         | T4 workspace appearance preferences and expanded chat snooze options remain available and stable.                                                                                                                                                                             | settings, UI-state, sidebar snooze, and `threadSnoozed.test.ts`                                                                                 |
| Desktop/nightly               | T4 icons, safe state-directory locking, release dependency handling, local nightly build/install flow, and packaged macOS Dock icon behavior remain intact.                                                                                                                   | desktop identity/lock tests and desktop-nightly script tests                                                                                    |
| Lotus integration             | Optional Lotus Runtime extension and project custom actions remain additive; Lotus owns its runtime lifecycle.                                                                                                                                                                | integration provider/MCP tests and project custom-action tests                                                                                  |
| Persistence ledger            | T4 migrations 36-38 keep shipped meanings. Upstream migrations formerly numbered 36-38 run as 41-43; T4 compatibility reruns remain 44-46; upstream 41-43 run as 47-49.                                                                                                       | `041_049_ForkCompatibility.test.ts`, migration-specific tests                                                                                   |

When a T3 change creates another read, write, transport, cache, pagination, or fallback path in one
of these areas, extend that path with every T4 field and policy. Add a regression using non-default
T4 data; null/default-only fixtures do not prove preservation.

## Historical T4 patch ledger

These patches establish current behavior. Commit IDs are provenance, not a substitute for tests:

- `0c00da909` — rebrand public surfaces as T4
- `978d4159a` — add AI app control plane, system entities, delegation, extensions, and Lotus support
- `65f2a359c` — exclude bundled release dependency
- `8692a18f7` — ship T4 macOS icons
- `a82c8f43f`, `71adac642` — move review into main view and add full diff workflow
- `0d580494f` — refine Viewed toggle behavior
- `3f547571c` — harden desktop nightly builds
- `5d88c1db4`, `887c0c435` — unify Quick Chat/environment control and agent UI instructions
- `1333ec61c` — add provider-neutral generated-view placements
- `d2603c60a` — expand snooze options
- `77bcf9b28` — expand workspace preferences
- `55cd50ad3`, `cbc5a25eb` — add URL launcher actions and launcher management
- `bcf4309f6` — add local desktop nightly installation tooling
- `70e49dd7c` — make agent skill wording T4-facing
- `e0f204da5` — remove generated project-save flow; keep `t3.json` hand-authored
- `53aac23b8` — add true chat-topbar split buttons
- `1a1974df4` — resolve project app views from active worktree
- `d3c15426c` — preserve packaged macOS Dock icon

## T3 integration procedure

1. Start from clean T4 `main`. Verify `origin` is the personal fork and `upstream` has no usable
   push URL.
2. Fetch T3 without pulling or merging. Select an exact upstream tag or SHA.
3. Run `vp run sync:t3:preflight -- <exact-upstream-tag-or-sha>`. Any path overlap blocks automatic
   integration and requires review against the inventory above.
4. Integrate the exact commit. Resolve each overlap deliberately; never use a blanket side choice.
5. Compare the resulting tree to upstream and confirm every intentional T4 delta still exists.
6. Run `vp run test:t4-invariants`, then focused tests/typechecks for every overlapping surface. Add
   non-default T4 fixtures for any new parallel path.
7. Update the sync record below with upstream SHA, T4 parent, overlaps, decisions, and validation.
8. Commit only after all choices are resolved. If an upstream behavior conflicts with a T4
   invariant, ask the user before the commit.

No-overlap preflight is not proof of compatibility. Contracts can cross files, so invariant tests
remain mandatory.

## Sync records

### 2026-08-10 — T3 nightly 20260810.1059

- T4 parent: `1a1974df4`
- T3 parent: `78f462c4e`
- Merge: `158a8f90b`
- Scope: 181 upstream commits, 644 changed files, 136 paths changed on both sides, 50 textual
  conflicts.
- Explicit resolution: preserve T4 migration IDs 36-38; map upstream migrations to 41-43 and add
  compatibility reruns 44-46.
- Missed semantic conflict: T3 pagination added a windowed message query without T4's required
  `delegation` field. Both HTTP and WebSocket thread snapshot paths then failed decoding, leaving
  clients at “Loading messages.” Regression coverage now requires delegated data through the
  windowed query.

### 2026-08-13 — T3 nightly 20260813.1087

- T4 parent: `8dab9c65b`
- T3 parent: `fd51561b4`
- Merge: `96c9e91af`
- Scope: 66 upstream commits, 349 changed files, 52 paths changed on both sides, 17 textual
  conflicts.
- Explicit resolution: preserve generated views, app-control routing, main-view review, expanded
  snooze choices, workspace shelf preferences, T4 branding, and patched `@pierre/diffs` 1.3.2;
  add upstream pull-request surfaces, shared diff styling, typography controls, and mobile fixes.
- Validation: T4 invariant suite (14 files, 119 tests), focused merge/fix suite (22 files, 646
  tests), web/client/server/desktop typechecks, and loopback-enabled server router tests passed.

### 2026-08-17 — T3 nightly 20260817.1119

- T4 parent: `e567a761b`
- T3 parent: `c7e6d711d`
- Merge: `030ee12b3`
- Scope: 143 upstream commits, 623 changed files, 117 paths changed on both sides, 38 textual
  conflict paths.
- Explicit resolution: preserve T4 branding and icons, generated views, app control, Quick Chat,
  main-view review, diff rail, workspace preferences, and settlement master switch; add upstream
  mobile flows, browser defaults and favicons, quit hold, source-control integrations, and release
  packaging. When agent browser access is disabled, keep T4 app control on a restricted MCP
  endpoint while withholding preview tools and their prompt instructions.
- Validation: T4 invariant suite (14 files, 122 tests), focused merge/fix suites (67 files, 1,463
  tests), typechecks across server, web, desktop, mobile, marketing, contracts, client runtime,
  shared, and scripts, plus loopback-enabled MCP and server integration tests passed.

### 2026-08-24 — T3 nightly 20260824.1176

- T4 parent: `7528b00fa`
- T3 parent: `f035a0f4c`
- Merge: `37593fa2b`
- Scope: 148 upstream commits, 502 changed files, 99 paths changed on both sides, 25 textual
  conflict paths.
- Explicit resolution: preserve T4 branding, icons, source-only distribution, generated views,
  app control, main-view review, worktree labels, settlement master switch, and patched
  `@pierre/diffs` 1.3.2; add upstream attachment uploads, client-origin tracking, macOS launchd
  support, terminal close safeguards, background composer sends, provider defaults, passkey
  updates, and mobile improvements. Preserve migration IDs 36-46 and map upstream
  `AuthSessionClientConnection` to migration 47. Omit the T3-only triage command and issue-routing
  assets because they clone and file against the fetch-only upstream project.
- Validation: T4 invariant suite (14 files, 126 tests), focused merge/fix suite (32 files, 670
  tests), typechecks across server, web, desktop, mobile, marketing, contracts, client runtime,
  and shared, plus `git diff --check` passed.
