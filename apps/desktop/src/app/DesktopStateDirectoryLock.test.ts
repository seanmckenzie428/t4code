// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the real atomic filesystem lock in temp directories.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { acquireDesktopStateDirectoryLock } from "./DesktopStateDirectoryLock.ts";

const withTempDir = (run: (directory: string) => void) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t4-state-lock-"));
  try {
    run(directory);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
};

const lockDependencies = (pid: number, token: string) => ({
  pid,
  platform: "darwin" as const,
  randomUUID: () => token,
  processIdentity: (candidatePid: number) => ({ marker: `start-${String(candidatePid)}` }),
  isProcessRunning: () => true,
});

describe("DesktopStateDirectoryLock", () => {
  it("excludes another brand using the same state directory", () =>
    withTempDir((directory) => {
      const first = acquireDesktopStateDirectoryLock(
        directory,
        "T3 Code (Alpha)",
        lockDependencies(101, "first"),
      );
      const second = acquireDesktopStateDirectoryLock(
        directory,
        "T4 Code (Nightly)",
        lockDependencies(202, "second"),
      );

      assert.equal(first.status, "acquired");
      assert.deepEqual(second, {
        status: "occupied",
        displayName: "T3 Code (Alpha)",
        pid: 101,
      });
      if (first.status === "acquired") first.release();
    }));

  it("lets a same-application launch continue to Electron focus handoff", () =>
    withTempDir((directory) => {
      const first = acquireDesktopStateDirectoryLock(
        directory,
        "T4 Code (Nightly)",
        lockDependencies(101, "first"),
      );
      const second = acquireDesktopStateDirectoryLock(
        directory,
        "T4 Code (Nightly)",
        lockDependencies(202, "second"),
      );

      assert.equal(first.status, "acquired");
      assert.deepEqual(second, { status: "same-application" });
      if (first.status === "acquired") first.release();
    }));

  it("publishes exactly one lock when acquisitions overlap", () =>
    withTempDir((directory) => {
      let nestedLock: ReturnType<typeof acquireDesktopStateDirectoryLock> | undefined;
      const first = acquireDesktopStateDirectoryLock(directory, "T3 Code", {
        ...lockDependencies(101, "first"),
        beforePublish: () => {
          nestedLock = acquireDesktopStateDirectoryLock(
            directory,
            "T4 Code",
            lockDependencies(202, "second"),
          );
        },
      });

      assert.equal(nestedLock?.status, "acquired");
      assert.deepEqual(first, { status: "occupied", displayName: "T4 Code", pid: 202 });
      if (nestedLock?.status === "acquired") nestedLock.release();
    }));

  it("reclaims a stale lock with a reused PID when process identity changed", () =>
    withTempDir((directory) => {
      const lockPath = NodePath.join(directory, "desktop-instance.lock");
      NodeFS.writeFileSync(
        lockPath,
        JSON.stringify({
          version: 1,
          pid: 101,
          displayName: "T3 Code",
          token: "stale",
          processIdentity: "old-start",
        }),
      );

      const lock = acquireDesktopStateDirectoryLock(directory, "T4 Code", {
        ...lockDependencies(202, "fresh"),
        processIdentity: (pid) => ({
          marker: pid === 101 ? "new-start" : `start-${String(pid)}`,
        }),
      });

      assert.equal(lock.status, "acquired");
      if (lock.status === "acquired") lock.release();
      assert.isFalse(NodeFS.existsSync(lockPath));
    }));

  it("does not reclaim a recent unreadable lock", () =>
    withTempDir((directory) => {
      NodeFS.writeFileSync(NodePath.join(directory, "desktop-instance.lock"), "");

      const lock = acquireDesktopStateDirectoryLock(
        directory,
        "T4 Code",
        lockDependencies(202, "fresh"),
      );

      assert.deepEqual(lock, {
        status: "occupied",
        displayName: "another T3/T4 Code instance",
        pid: null,
      });
    }));

  it("rejects non-positive owner and runtime PIDs", () =>
    withTempDir((directory) => {
      const lockPath = NodePath.join(directory, "desktop-instance.lock");
      NodeFS.writeFileSync(
        lockPath,
        JSON.stringify({ version: 1, pid: 0, displayName: "T3 Code", token: "invalid" }),
      );
      NodeFS.utimesSync(lockPath, 0, 0);
      NodeFS.writeFileSync(
        NodePath.join(directory, "server-runtime.json"),
        JSON.stringify({ version: 1, pid: -1, port: 3773 }),
      );

      const lock = acquireDesktopStateDirectoryLock(
        directory,
        "T4 Code",
        lockDependencies(202, "fresh"),
      );

      assert.equal(lock.status, "acquired");
      if (lock.status === "acquired") lock.release();
    }));

  it("rejects a non-positive current process PID", () =>
    withTempDir((directory) => {
      assert.throws(() =>
        acquireDesktopStateDirectoryLock(directory, "T4 Code", {
          ...lockDependencies(0, "invalid"),
        }),
      );
    }));

  it("rejects a legacy live server before backend bootstrap", () =>
    withTempDir((directory) => {
      NodeFS.writeFileSync(
        NodePath.join(directory, "server-runtime.json"),
        JSON.stringify({ version: 1, pid: 303, port: 3773 }),
      );

      const lock = acquireDesktopStateDirectoryLock(directory, "T4 Code", {
        ...lockDependencies(202, "fresh"),
        isProcessRunning: (pid) => pid === 303,
      });

      assert.deepEqual(lock, {
        status: "occupied",
        displayName: "another T3/T4 Code server",
        pid: 303,
      });
      assert.isFalse(NodeFS.existsSync(NodePath.join(directory, "desktop-instance.lock")));
    }));

  it("ignores legacy runtime state when its PID was recycled", () =>
    withTempDir((directory) => {
      NodeFS.writeFileSync(
        NodePath.join(directory, "server-runtime.json"),
        JSON.stringify({
          version: 1,
          pid: 303,
          port: 3773,
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      );

      const lock = acquireDesktopStateDirectoryLock(directory, "T4 Code", {
        ...lockDependencies(202, "fresh"),
        isProcessRunning: (pid) => pid === 303,
        processIdentity: (pid) => ({
          marker: `start-${String(pid)}`,
          ...(pid === 303 ? { startedAtMs: Date.parse("2026-01-02T00:00:00.000Z") } : {}),
        }),
      });

      assert.equal(lock.status, "acquired");
      if (lock.status === "acquired") lock.release();
    }));

  it("conservatively blocks a live legacy PID when creation time is unavailable", () =>
    withTempDir((directory) => {
      NodeFS.writeFileSync(
        NodePath.join(directory, "server-runtime.json"),
        JSON.stringify({
          version: 1,
          pid: 303,
          port: 3773,
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      );

      const lock = acquireDesktopStateDirectoryLock(directory, "T4 Code", {
        ...lockDependencies(202, "fresh"),
        isProcessRunning: (pid) => pid === 303,
        processIdentity: (pid) =>
          pid === 303 ? { marker: "windows-no-creation-time" } : { marker: `start-${String(pid)}` },
      });

      assert.deepEqual(lock, {
        status: "occupied",
        displayName: "another T3/T4 Code server",
        pid: 303,
      });
    }));
});
