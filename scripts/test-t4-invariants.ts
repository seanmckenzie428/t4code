#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

const invariantTests = [
  "packages/shared/src/branding.test.ts",
  "apps/desktop/src/app/DesktopAppIdentity.test.ts",
  "apps/server/src/persistence/Migrations/041_046_ForkCompatibility.test.ts",
  "apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts",
  "apps/server/src/quickChat/QuickChat.test.ts",
  "apps/server/src/mcp/AppControlPolicy.test.ts",
  "packages/contracts/src/appViews.test.ts",
  "apps/web/src/appViewCommandHost.test.ts",
  "apps/web/src/components/app-views/AppViewPlacements.logic.test.ts",
  "apps/web/src/hooks/useT3ProjectFileAppViews.test.ts",
  "apps/web/src/lib/diffCollapse.test.ts",
  "packages/client-runtime/src/state/threadSnoozed.test.ts",
  "scripts/lib/desktop-nightly-install.test.ts",
  "scripts/lib/t4-upstream-overlap.test.ts",
] as const;

const result = NodeChildProcess.spawnSync("vp", ["test", "run", ...invariantTests], {
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
