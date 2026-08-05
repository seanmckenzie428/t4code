#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import desktopPackageJson from "../apps/desktop/package.json" with { type: "json" };
import { resolveDesktopNightlyForwardedArgs } from "./lib/desktop-nightly-args.ts";
import { resolveLocalNightlyVersion } from "./resolve-nightly-release.ts";

const now = new Date();
const version = Effect.runSync(
  resolveLocalNightlyVersion(desktopPackageJson.version, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    seconds: now.getUTCSeconds(),
  }),
);
const artifactBuilder = NodeURL.fileURLToPath(
  new URL("./build-desktop-artifact.ts", import.meta.url),
);
const forwardedArgs = resolveDesktopNightlyForwardedArgs(process.argv.slice(2));

Effect.runSync(Console.log(`[desktop-nightly] Building T4 Code ${version}`));

const result = NodeChildProcess.spawnSync(
  process.execPath,
  [artifactBuilder, "--build-version", version, ...forwardedArgs],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
