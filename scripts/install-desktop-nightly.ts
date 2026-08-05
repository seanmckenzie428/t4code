#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import {
  isExpectedDesktopNightlyBundle,
  resolveDesktopNightlyInstallArch,
  resolveDesktopNightlyZipArtifact,
} from "./lib/desktop-nightly-install.ts";

const APP_NAME = "T4 Code (Nightly).app";
const SYSTEM_APPLICATIONS_DIRECTORY = "/Applications";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

function runChecked(command: string, args: ReadonlyArray<string>, stdio: "inherit" | "pipe") {
  const result = NodeChildProcess.spawnSync(command, [...args], {
    encoding: stdio === "pipe" ? "utf8" : undefined,
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${command} failed${stderr ? `: ${stderr}` : "."}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function canWrite(path: string): boolean {
  try {
    NodeFS.accessSync(path, NodeFS.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInstallTarget(): string {
  const systemTarget = NodePath.join(SYSTEM_APPLICATIONS_DIRECTORY, APP_NAME);
  if (NodeFS.existsSync(systemTarget)) {
    const getUid = process.getuid;
    const ownedByCurrentUser =
      getUid !== undefined && NodeFS.statSync(systemTarget).uid === getUid();
    if (ownedByCurrentUser && canWrite(systemTarget) && canWrite(SYSTEM_APPLICATIONS_DIRECTORY)) {
      return systemTarget;
    }
  } else if (canWrite(SYSTEM_APPLICATIONS_DIRECTORY)) {
    return systemTarget;
  }

  const userApplicationsDirectory = NodePath.join(NodeOS.homedir(), "Applications");
  NodeFS.mkdirSync(userApplicationsDirectory, { recursive: true });
  return NodePath.join(userApplicationsDirectory, APP_NAME);
}

function readPlistValue(appPath: string, key: string): string {
  return runChecked(
    PLIST_BUDDY,
    ["-c", `Print :${key}`, NodePath.join(appPath, "Contents", "Info.plist")],
    "pipe",
  );
}

function validateNightlyApp(appPath: string): string {
  if (!NodeFS.statSync(appPath).isDirectory()) {
    throw new Error(`Built nightly app is missing: ${appPath}`);
  }
  const bundleId = readPlistValue(appPath, "CFBundleIdentifier");
  const version = readPlistValue(appPath, "CFBundleShortVersionString");
  if (!isExpectedDesktopNightlyBundle({ bundleId, version })) {
    throw new Error(`Refusing to install unexpected app bundle ${bundleId} ${version}.`);
  }
  return version;
}

function installApp(stagedApp: string, targetApp: string): void {
  const previousApp = `${targetApp}.previous`;
  if (NodeFS.existsSync(previousApp)) {
    NodeFS.rmSync(previousApp, { recursive: true, force: true });
  }

  const hadExistingApp = NodeFS.existsSync(targetApp);
  if (hadExistingApp) {
    NodeFS.renameSync(targetApp, previousApp);
  }

  try {
    NodeFS.renameSync(stagedApp, targetApp);
    runChecked("codesign", ["--verify", "--deep", "--strict", targetApp], "pipe");
  } catch (error) {
    if (NodeFS.existsSync(targetApp)) {
      NodeFS.rmSync(targetApp, { recursive: true, force: true });
    }
    if (hadExistingApp && NodeFS.existsSync(previousApp)) {
      NodeFS.renameSync(previousApp, targetApp);
    }
    throw error;
  }
}

function notifyInstalled(version: string, targetApp: string): void {
  runChecked(
    "osascript",
    [
      "-e",
      `display notification "Quit and reopen T4 Code to use ${version}." with title "T4 Code Nightly installed" sound name "Glass"`,
    ],
    "inherit",
  );
  Effect.runSync(Console.log(`[desktop-nightly] Installed ${version} at ${targetApp}`));
  Effect.runSync(Console.log("[desktop-nightly] Quit and reopen T4 Code to use the new build."));
}

function main(): void {
  const host = Effect.runSync(
    Effect.all({ platform: HostProcessPlatform, arch: HostProcessArchitecture }),
  );
  const arch = resolveDesktopNightlyInstallArch(host.platform, host.arch);
  const repoRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  const artifactDirectory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t4-nightly-artifacts-"),
  );
  let installStageDirectory: string | null = null;

  try {
    const nightlyBuilder = NodePath.join(repoRoot, "scripts", "build-desktop-nightly.ts");
    runChecked(
      process.execPath,
      [nightlyBuilder, "--arch", arch, "--output-dir", artifactDirectory],
      "inherit",
    );

    const zipName = resolveDesktopNightlyZipArtifact(NodeFS.readdirSync(artifactDirectory), arch);
    const zipPath = NodePath.join(artifactDirectory, zipName);
    const targetApp = resolveInstallTarget();
    const targetDirectory = NodePath.dirname(targetApp);
    installStageDirectory = NodeFS.mkdtempSync(
      NodePath.join(targetDirectory, ".t4-nightly-install-"),
    );
    const extractedDirectory = NodePath.join(installStageDirectory, "extracted");
    NodeFS.mkdirSync(extractedDirectory);
    runChecked("ditto", ["-x", "-k", zipPath, extractedDirectory], "inherit");

    const stagedApp = NodePath.join(extractedDirectory, APP_NAME);
    const version = validateNightlyApp(stagedApp);
    runChecked("codesign", ["--force", "--deep", "--sign", "-", stagedApp], "inherit");
    runChecked("codesign", ["--verify", "--deep", "--strict", stagedApp], "pipe");
    installApp(stagedApp, targetApp);
    notifyInstalled(version, targetApp);
  } finally {
    NodeFS.rmSync(artifactDirectory, { recursive: true, force: true });
    if (installStageDirectory !== null) {
      NodeFS.rmSync(installStageDirectory, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  Effect.runSync(Console.error("[desktop-nightly] Build/install failed.", error));
  process.exitCode = 1;
}
