# Pilot fork invariants

Pilot (formerly T4 Code) is a long-lived fork of upstream T3 Code, not a temporary patch stack. Upstream work is welcome only when it
preserves Pilot behavior. Git conflict resolution is insufficient: independently added code paths can
merge cleanly while omitting a required Pilot field or bypassing a Pilot policy.

## Precedence

- Pilot behavior wins by default.
- Preserve compatible upstream improvements alongside Pilot behavior.
- Never accept an upstream file wholesale, use blanket `-X theirs`, renumber shipped Pilot
  migrations, remove a Pilot test to make upstream pass, or silently replace a Pilot workflow.
- If both behaviors cannot coexist, stop before committing and ask the user which takes precedence.
- Treat every shared path as a semantic conflict even when Git reports no textual conflict.

## Current Pilot behavior inventory

| Area                          | Pilot invariant                                                                                                                                                                                                                                                               | Main protection                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Branding and distribution     | Visible product is Pilot/Pilot Connect; `t4` is canonical local CLI and `t3` remains compatibility alias; upstream publishing stays disabled; personal `origin` is push target and T3 `upstream` is fetch-only.                                                               | `packages/shared/src/branding.test.ts`, `apps/web/src/branding.test.ts`, `apps/desktop/src/app/DesktopAppIdentity.test.ts`, release smoke tests |
| Compatibility identifiers     | Persisted, protocol, package, service, scheme, bundle, state, relay, and configuration identifiers listed in `t4-compatibility.md` stay T3-compatible.                                                                                                                        | `docs/internals/t4-compatibility.md`, compatibility and auth tests                                                                              |
| App control                   | Agents use a provider-neutral, typed, policy-checked command surface with audits, grants, client invocation, bounded destructive actions, and no raw DB/credential access.                                                                                                    | `AppControlPolicy.test.ts`, `AppControlServerExecutor.test.ts`, app-control contract tests                                                      |
| Quick Chat and delegation     | Environment Quick Chat remains outside projects, uses its system entities/control-only profile, supports bounded project delegation, and preserves delegation origin on projected messages.                                                                                   | `QuickChat.test.ts`, `decider.systemEntities.test.ts`, `ProjectionSnapshotQuery.test.ts`                                                        |
| Generated views               | Native/sandboxed views, bounded launcher placements, URL actions, management controls, and chat-topbar split buttons remain supported. Generated writes are machine-local/personal; project `t3.json` is hand-authored and read-only to generated UI.                         | `appViews.test.ts`, `appViewCommandHost.test.ts`, `AppViewPlacements.logic.test.ts`, `GeneratedViewLibrary.logic.test.ts`                       |
| Active-worktree project views | Project launchers resolve the active thread worktree first, wait for that query, then fall back to project root only when worktree `t3.json` is absent. Lotus-local launcher URLs bind to the active thread's Lotus workspace instead of a stack hardcoded in project config. | `useT3ProjectFileAppViews.test.ts`                                                                                                              |
| Main review workflow          | Horizontal Chat/Review tabs retain full diff navigation. Viewed revisions persist per environment/thread/scope: unchanged files reopen collapsed; changed files expand with Changed since viewed. Clearing Viewed expands the file.                                           | review service, main-view, diff rail, `diffPanelStore.test.ts`, and `diffCollapse.test.ts`                                                      |
| Workspace preferences         | Pilot workspace appearance preferences and expanded chat snooze options remain available and stable.                                                                                                                                                                          | settings, UI-state, sidebar snooze, and `threadSnoozed.test.ts`                                                                                 |
| Desktop/nightly               | Pilot icons, safe state-directory locking, release dependency handling, local nightly build/install flow, and packaged macOS Dock icon behavior remain intact.                                                                                                                | desktop identity/lock tests and desktop-nightly script tests                                                                                    |
| Lotus integration             | Optional Lotus Runtime extension and project custom actions remain additive; Lotus owns its runtime lifecycle.                                                                                                                                                                | integration provider/MCP tests and project custom-action tests                                                                                  |
| Persistence ledger            | Pilot migration IDs 36-46 keep shipped meanings. Upstream migrations formerly numbered 36-38 run as 41-43; compatibility reruns remain 44-46; upstream 41-54 run as 47-60.                                                                                                    | `041_049_ForkCompatibility.test.ts`                                                                                                             |

When a T3 change creates another read, write, transport, cache, pagination, or fallback path in one
of these areas, extend that path with every Pilot field and policy. Add a regression using non-default
Pilot data; null/default-only fixtures do not prove preservation.

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

1. Start from clean Pilot `main`. Verify `origin` is the personal fork and `upstream` has no usable
   push URL.
2. Fetch T3 without pulling or merging. Select an exact upstream tag or SHA.
3. Run `vp run sync:t3:preflight -- <exact-upstream-tag-or-sha>`. Any path overlap blocks automatic
   integration and requires review against the inventory above.
4. Integrate the exact commit. Resolve each overlap deliberately; never use a blanket side choice.
5. Compare the resulting tree to upstream and confirm every intentional Pilot delta still exists.
6. Run `vp run test:t4-invariants`, then focused tests/typechecks for every overlapping surface. Add
   non-default Pilot fixtures for any new parallel path.
7. Update the sync record below with upstream SHA, Pilot parent, overlaps, decisions, and validation.
8. Commit only after all choices are resolved. If an upstream behavior conflicts with a Pilot
   invariant, ask the user before the commit.

No-overlap preflight is not proof of compatibility. Contracts can cross files, so invariant tests
remain mandatory.

## Sync records

### 2026-09-29 — T3 v0.0.43

- T4 parent: `cb67721cc99c40ce265a11d7d46954a05fa857ba`; T3 parent:
  `2cbc24fcae2b5649d7b60b68da72053a37fa82d5` (latest upstream `main` when fetched).
- Integrated 252 upstream commits. Exact-SHA preflight identified 187 overlapping paths;
  reviewed clean merges alongside 48 unmerged paths. Retained T4 branding and compatibility
  identifiers, Quick Chat, app control, generated views, Chat/Review and Viewed persistence,
  hover sidebar, workspace preferences, manual settlement, and desktop state locking.
- Kept upstream background queued sends on T4's typed command surface. Preserved T4 provider
  instructions alongside the new Codex context transport and managed authentication. Added
  upstream per-thread auto-settle settings without changing the existing environment behavior.
  New lightweight PR and settlement queries retain Quick Chat/assistant exclusions, with
  non-default regression fixtures.
- Migration ledger 1–59 retains its shipped IDs, names, and modules; upstream migration 54
  appends as runtime 60. Populated-upgrade coverage checks preserved T4 rows and ledger entries.
- Kept source-only distribution and omitted upstream triage tooling. Combined overlapping relay
  deployment guards so both the upstream-repository and main-branch restrictions apply.
- Validation: T4 invariants passed (15 files / 162 tests); focused web checks passed
  (41 files / 1,182 tests), desktop/shared/mobile checks passed (33 files / 926 tests),
  packaging checks passed (4 files / 110 tests), and focused server/provider/relay checks passed.
  Scoped typechecks passed for server, web, desktop, mobile, contracts, shared, client runtime,
  Codex protocol, marketing, and scripts. Release smoke, scoped formatting/lint, and source
  whitespace checks passed; lint retains existing warnings and upstream patch files retain
  unified-diff context whitespace. Local socket tests passed with loopback permissions.
  No live database writes, interactive UI verification, app install/restart, or push performed.

### 2026-09-21 — T3 nightly 20260921.2058 after T4 recovery

- T4 parent: `c0afb5c4f18b62c0f300d372c34ef84e0ffc490c` (recovered reviewed T4 source
  before updating upstream). T3 parent: `1de563c1491c7d82563e4553bf5bf689ce6adbb9`;
  tag `v0.0.43-nightly.20260921.2058`.
- Exact-SHA preflight identified 131 overlapping paths; reviewed clean merges as well as
  42 unmerged paths. Preserved the 3rem hover rail and native titlebar clearance, horizontal
  Chat/Review, scoped persistent Viewed revisions, Mermaid, Lotus labels/launchers,
  Quick Chat, app-control policies, manual settlement, preview history/highlights/new tabs,
  and human shortcuts isolated from automated preview keys.
- Added compatible upstream recording, PR Viewed persistence, responsive header controls,
  and lifecycle Undo. Batch settle/snooze and Undo reversals retain T4 command routing;
  renderer-only options stay outside wire arguments. The new collapsed thought preview
  strips unsupported assistant directives, with rendered streaming/nonstreaming regressions.
- Migration IDs, names, and modules 1–58 remain unchanged. Upstream migration 53 appends
  as runtime 59 (`PullRequestFilesViewed`); a populated 58-to-59 upgrade preserves prior
  ledger entries, T4 rows, and Viewed records on rerun. Test-only SQLite constructors use
  the current API. The intentionally omitted upstream triage command remains omitted.
- Retained T4 direct simulator workflows alongside upstream Browser/Device panel guidance
  and dual-mode mobile pairing. Kept publishing upstream-gated and T4 artifact branding.
  The native dependency closure test now starts from declared runtime roots, ignoring
  removed packages left in pnpm's store while still rejecting reachable missing externals.
- Validation: 61 focused files / 1,860 tests passed; T4 invariants passed (15 files / 158 tests).
  Web, desktop, server, mobile, and build-script typechecks passed. Scoped formatting/lint
  passed with existing warnings; release smoke and five isolated pairing-helper cases passed.
  No live database writes, browser/native UI verification, push, or app restart performed.

### 2026-09-21 — recover reviewed T4 Nightly on main

- T4 main parent: `6c653cf90c7651614a1f980aa8a81153ace69010` (included the sidebar rail,
  but still used the older August source). Restored reviewed Nightly branch
  `d237e30aa44c4c036c4dd27c94f575de369e6716`, including the September 17 T3 integration
  and September 18 Review fixes, before integrating newer T3 changes.
- Resolved 91 unmerged paths by preserving both T4 lines of work: hover rail and titlebar
  clearance, navigation/close actions, preview highlights and new-tab routing, Mermaid,
  manual settlement, Lotus worktree labels/launchers, Quick Chat, and persistent Viewed state.
  Scripted OAuth popups retain the upstream hardened window path.
- Existing migration IDs, names, and modules 1–49 remain identical to main; new upstream
  migrations append at 50–58. Live data is not rewritten during source recovery.
- Kept the upstream triage CLI intentionally omitted. Publishing workflows remain gated
  to upstream. Enlarged the preflight Git output buffer after the large reference-tree delta
  exceeded Node's default buffer; overlap checks remain mandatory.
- Validation: T4 invariants passed (15 files, 157 tests); focused client/desktop tests passed
  (16 files, 668 tests); focused server/provider tests passed (11 files, 435 tests).
  Web, desktop, server, and mobile typechecks passed. Provider identity regressions cover normal,
  assistant, and Quick Chat sessions with browser access disabled. Preview keyboard regressions
  preserve human app shortcuts while keeping native/CDP automation inside the preview.
  No interactive browser/native verification or app restart was performed.

### 2026-09-17 — T3 nightly 20260917.1866

- T4 parent: `80b2a458d5a7f4f3cd26ce118e10a1c43bc3e7f0`
- T3 parent: `d4d5d12e8ba086cfbf79ca3adeb4156b46ead665`
- Upstream tag: `v0.0.43-nightly.20260917.1866`
- Scope: 1,671 upstream commits since common ancestor `78f462c4e18c8ea5e5037dc916389a3b72246025`,
  237 paths changed on both sides, 133 unmerged index paths requiring explicit resolution.
- Preflight: the package runner initially lacked its installed Vite dependency. After fetching the
  exact tag, direct execution of `scripts/check-t4-upstream-overlap.ts` produced the overlap report;
  every overlap was reviewed before committing.
- Persistence: preserve all shipped T4 migration IDs 36-46; assign new upstream migrations 41-52
  runtime IDs 47-58. New message context, turn-start lookup, stream append, and snapshot paths keep
  T4 delegation and system-entity fields. Non-default regression data covers these parallel paths.
- Providers and app control: retain T4 typed principals, grants, audits, Quick Chat, delegation,
  generated views, project custom actions, and optional Lotus integration alongside upstream device,
  pull-request, provider, and command changes. Quick Chat remains Codex-only. Legacy pending forms
  and approvals still block settling; newly introduced asynchronous message requests can be dismissed.
- Clients: retain main-view Review, Viewed state, full file navigation, workspace preferences,
  expanded snooze controls, generated-view placement controls, and active-worktree resolution.
  Upstream lazy diff loading and new right-panel capabilities coexist with these flows. File
  membership survives lazy patch loading; read-only expansion remains available when editing is
  unavailable. Background refreshes preserve active edits.
- Dependencies: retain T4's stable `@pierre/diffs` 1.3.2 and port compatible upstream virtualization,
  highlighting, cache, and resize fixes. Keep stable editor behavior and correct wrapped EOF range
  calculation with existing assertions. Adapt T4 Effect code to the upstream RC API.
- Distribution: retain T4 names, icons, compatibility identifiers, macOS Dock behavior, state
  safeguards, and local build/install scripts. Newly introduced publishing workflows are guarded
  against running on the fork; source-only T4 distribution remains explicit in user docs.
- Validation: all 14 required invariant files passed (136 tests), including a populated T4 ledger
  46-to-58 upgrade with unchanged prior ledger/data and an idempotent rerun. Focused server,
  contracts, client-runtime, web, desktop, mobile, marketing, and packaging tests passed. Scoped
  typechecks, lint, formatting, and production web build passed; lint/build retain nonblocking
  warnings. Loopback tests passed with local socket permissions; path fixtures passed with
  canonical `TMPDIR=/private/tmp`. Source whitespace checks passed; full-tree checking reports
  unchanged upstream reference/patch whitespace and unified-diff context indentation. Browser/native
  interactive testing and app installation were outside this merge request.

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

### 2026-08-27 — T3 nightly 20260827.1206

- T4 parent: `efe941e8b`
- T3 parent: `f6f2be32d`
- Merge: `c83e8f7a5`
- Scope: 41 upstream commits, 215 changed files, 54 paths changed on both sides, 6 textual
  conflict paths.
- Explicit resolution: preserve T4 branding, source-only distribution, generated views, app
  control, Quick Chat, main-view review, workspace bindings, delegation, terminal-close
  confirmation, sidebar shelf preferences, and patched `@pierre/diffs` 1.3.2; add upstream linked
  pull requests, active-list re-entry ordering, Claude resume compaction, model manifests, Grok
  skills, mobile improvements, and faster macOS signing. Preserve migration IDs 36-47 and map
  upstream `ProjectionThreadLinkedPullRequest` and `ProjectionThreadsUnsettledAt` to migrations
  48-49. Omit the T3 preview-release workflow because T4 remains source-only, and keep all
  remaining release jobs gated to the upstream repository.
- Validation: T4 invariant suite (14 files, 126 tests), focused merge/fix suite (24 files, 584
  tests), typechecks across server, web, desktop, mobile, contracts, client runtime, shared,
  scripts, and the Codex app-server schema package, targeted lint/format checks, and
  `git diff --check` passed.
