#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import { findT4UpstreamOverlaps, parseGitPathList } from "./lib/t4-upstream-overlap.ts";

function runGit(args: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // Vendored reference updates can exceed spawnSync's default 1 MiB path buffer.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 1) {
  throw new Error("Usage: vp run sync:t3:preflight -- <exact-upstream-tag-or-sha>");
}

const [target] = args;
const dirtyPaths = parseGitPathList(runGit(["status", "--porcelain=v1", "-z"]));
if (dirtyPaths.length > 0) {
  throw new Error("T3 sync preflight requires a clean worktree.");
}

const targetCommit = runGit(["rev-parse", "--verify", `${target}^{commit}`]).trim();
const base = runGit(["merge-base", "HEAD", targetCommit]).trim();
const t4Paths = parseGitPathList(runGit(["diff", "--name-only", "-z", `${base}..HEAD`, "--"]));
const upstreamPaths = parseGitPathList(
  runGit(["diff", "--name-only", "-z", `${base}..${targetCommit}`, "--"]),
);
const overlaps = findT4UpstreamOverlaps(t4Paths, upstreamPaths);

if (overlaps.length === 0) {
  process.stdout.write(`[t4-sync] No path overlap with ${targetCommit}.\n`);
  process.stdout.write("[t4-sync] Still run T4 invariant tests after integrating upstream.\n");
} else {
  process.stderr.write(
    `[t4-sync] BLOCKED: ${overlaps.length} path(s) changed by T4 and upstream:\n`,
  );
  for (const path of overlaps) {
    process.stderr.write(`${path}\n`);
  }
  process.stderr.write(
    "[t4-sync] Review each overlap against docs/internals/t4-fork-invariants.md. " +
      "Preserve both behaviors when possible; ask user before choosing incompatible upstream behavior.\n",
  );
  process.exitCode = 2;
}
