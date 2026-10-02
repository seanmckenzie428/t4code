#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

const invariantTests = [
  "packages/shared/src/branding.test.ts",
  "apps/desktop/src/app/DesktopAppIdentity.test.ts",
  "apps/desktop/src/app/DesktopUserDataMigration.test.ts",
  "apps/desktop/src/app/DesktopStateDirectoryLock.test.ts",
  "apps/server/src/persistence/Migrations/041_049_ForkCompatibility.test.ts",
  "apps/server/src/orchestration-v2/ProjectStore.test.ts",
  "apps/server/src/orchestration-v2/ProjectionStore.test.ts",
  "apps/server/src/orchestration-v2/NativeThreadArchive.test.ts",
  "apps/server/src/orchestration-v2/Adapters/CursorLegacyAcp.test.ts",
  "apps/server/src/provider/acp/CursorAcpSupport.test.ts",
  "apps/server/src/provider/acp/CursorAcpExtension.test.ts",
  "apps/server/src/orchestration-v2/ProviderSessionManager.test.ts",
  "apps/server/src/provider/CodexDeveloperInstructions.test.ts",
  "apps/server/src/orchestration-v2/legacy/LegacyV1ThreadImporter.test.ts",
  "apps/server/src/orchestration-v2/legacy/LegacyV1Cutover.integration.test.ts",
  "apps/server/src/orchestration-v2/legacy/PilotLegacyHistory.test.ts",
  "apps/server/src/orchestration-v2/legacy/ClaudeForkTurnBoundaries.test.ts",
  "apps/server/src/orchestration-v2/legacy/PilotLegacyWorkLog.test.ts",
  "apps/server/src/orchestration-v2/decider.systemEntities.test.ts",
  "apps/server/src/orchestration-v2/ThreadArchiveService.test.ts",
  "apps/server/src/mcp/AppControlPolicy.test.ts",
  "packages/contracts/src/appViews.test.ts",
  "apps/web/src/appViewCommandHost.test.ts",
  "apps/web/src/components/app-views/AppViewPlacements.logic.test.ts",
  "apps/web/src/hooks/useT3ProjectFileAppViews.test.ts",
  "apps/web/src/lib/diffCollapse.test.ts",
  "apps/web/src/diffPanelStore.test.ts",
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
