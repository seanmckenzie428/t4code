// @effect-diagnostics nodeBuiltinImport:off - Atomic directories and PID identity form an OS process lock.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const LOCK_DIRECTORY_NAME = "desktop-instance.lock";
const RECLAIM_DIRECTORY_NAME = "desktop-instance.reclaim";
const SERVER_RUNTIME_FILE_NAME = "server-runtime.json";
const UNREADABLE_LOCK_GRACE_MS = 30_000;

interface LockOwner {
  readonly version: 1;
  readonly pid: number;
  readonly displayName: string;
  readonly token: string;
  readonly processIdentity?: string;
}

interface ProcessIdentity {
  readonly marker: string;
  readonly startedAtMs?: number;
}

interface RuntimeOwner {
  readonly pid: number;
  readonly startedAtMs?: number;
}

export type DesktopStateDirectoryLock =
  | { readonly status: "acquired"; readonly release: () => void }
  | { readonly status: "same-application" }
  | { readonly status: "occupied"; readonly displayName: string; readonly pid: number | null };

export interface DesktopStateDirectoryLockDependencies {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  readonly now?: () => number;
  readonly isProcessRunning?: (pid: number) => boolean;
  readonly processIdentity?: (pid: number) => ProcessIdentity | undefined;
  readonly randomUUID?: () => string;
  /** Test seam for overlapping acquisition immediately before atomic publication. */
  readonly beforePublish?: () => void;
}

const isPositivePid = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

const isProcessRunning = (pid: number): boolean => {
  if (!isPositivePid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readLinuxProcessIdentity = (pid: number): ProcessIdentity | undefined => {
  try {
    const stat = NodeFS.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const fieldsAfterCommand = stat
      .slice(stat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    const marker = fieldsAfterCommand[19];
    if (marker === undefined) return undefined;
    const bootTimeLine = NodeFS.readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((line) => line.startsWith("btime "));
    const bootTimeSeconds = Number(bootTimeLine?.slice("btime ".length));
    const clockTicks = Number(
      NodeChildProcess.spawnSync("getconf", ["CLK_TCK"], {
        encoding: "utf8",
        timeout: 1_000,
      }).stdout.trim(),
    );
    const startTicks = Number(marker);
    const startedAtMs =
      Number.isFinite(bootTimeSeconds) && Number.isFinite(clockTicks) && clockTicks > 0
        ? (bootTimeSeconds + startTicks / clockTicks) * 1_000
        : undefined;
    return { marker, ...(startedAtMs === undefined ? {} : { startedAtMs }) };
  } catch {
    return undefined;
  }
};

const readDarwinProcessIdentity = (pid: number): ProcessIdentity | undefined => {
  const result = NodeChildProcess.spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 1_000,
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  if (value.length === 0) return undefined;
  const startedAtMs = Date.parse(value);
  return {
    marker: value,
    ...(Number.isNaN(startedAtMs) ? {} : { startedAtMs }),
  };
};

const processIdentity = (pid: number, platform: NodeJS.Platform): ProcessIdentity | undefined => {
  if (!isPositivePid(pid)) return undefined;
  if (platform === "linux") return readLinuxProcessIdentity(pid);
  if (platform === "darwin") return readDarwinProcessIdentity(pid);
  return undefined;
};

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

const readLockOwner = (lockPath: string): LockOwner | undefined => {
  const value = readJson(lockPath);
  if (typeof value !== "object" || value === null) return undefined;
  const owner = value as Partial<LockOwner>;
  if (
    owner.version !== 1 ||
    !isPositivePid(owner.pid) ||
    typeof owner.displayName !== "string" ||
    typeof owner.token !== "string" ||
    (owner.processIdentity !== undefined && typeof owner.processIdentity !== "string")
  ) {
    return undefined;
  }
  return owner as LockOwner;
};

const readRuntimeOwner = (path: string): RuntimeOwner | undefined => {
  const value = readJson(path);
  if (typeof value !== "object" || value === null) return undefined;
  const runtime = value as { readonly pid?: unknown; readonly startedAt?: unknown };
  if (!isPositivePid(runtime.pid)) return undefined;
  const parsedStartedAt =
    typeof runtime.startedAt === "string" ? Date.parse(runtime.startedAt) : Number.NaN;
  return {
    pid: runtime.pid,
    ...(Number.isNaN(parsedStartedAt) ? {} : { startedAtMs: parsedStartedAt }),
  };
};

const isOwnerRunning = (
  owner: LockOwner,
  running: (pid: number) => boolean,
  identify: (pid: number) => ProcessIdentity | undefined,
): boolean => {
  if (!running(owner.pid)) return false;
  const currentIdentity = identify(owner.pid);
  return (
    owner.processIdentity === undefined ||
    currentIdentity === undefined ||
    owner.processIdentity === currentIdentity.marker
  );
};

const isRuntimeOwnerRunning = (
  owner: RuntimeOwner,
  running: (pid: number) => boolean,
  identify: (pid: number) => ProcessIdentity | undefined,
): boolean => {
  if (!running(owner.pid)) return false;
  const processStartedAt = identify(owner.pid)?.startedAtMs;
  if (owner.startedAtMs === undefined || processStartedAt === undefined) {
    // Windows and restricted hosts lack a cheap reliable creation-time lookup.
    // Conservatively protect the state directory while that PID is alive.
    return true;
  }
  return processStartedAt <= owner.startedAtMs + 2_000;
};

const isRecentDirectory = (path: string, now: number): boolean => {
  try {
    return now - NodeFS.statSync(path).mtimeMs < UNREADABLE_LOCK_GRACE_MS;
  } catch {
    return false;
  }
};

export function acquireDesktopStateDirectoryLock(
  stateDir: string,
  displayName: string,
  dependencies: DesktopStateDirectoryLockDependencies,
): DesktopStateDirectoryLock {
  const pid = dependencies.pid;
  if (!isPositivePid(pid)) throw new Error(`Invalid desktop process ID: ${String(pid)}`);
  const now = dependencies.now ?? Date.now;
  const running = dependencies.isProcessRunning ?? isProcessRunning;
  const platform = dependencies.platform;
  const identify =
    dependencies.processIdentity ??
    ((candidatePid: number) => processIdentity(candidatePid, platform));
  const token = (dependencies.randomUUID ?? NodeCrypto.randomUUID)();
  const lockPath = NodePath.join(stateDir, LOCK_DIRECTORY_NAME);
  const reclaimPath = NodePath.join(stateDir, RECLAIM_DIRECTORY_NAME);
  const runtimePath = NodePath.join(stateDir, SERVER_RUNTIME_FILE_NAME);
  const candidatePath = NodePath.join(stateDir, `.desktop-instance.${token}.candidate`);
  const currentProcessIdentity = identify(pid);
  const owner: LockOwner = {
    version: 1,
    pid,
    displayName,
    token,
    ...(currentProcessIdentity === undefined
      ? {}
      : { processIdentity: currentProcessIdentity.marker }),
  };

  NodeFS.mkdirSync(stateDir, { recursive: true });
  NodeFS.writeFileSync(candidatePath, `${JSON.stringify(owner)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    dependencies.beforePublish?.();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // The candidate is complete before its hard link becomes visible.
        // Unlike rename, link never replaces even an empty existing target.
        NodeFS.linkSync(candidatePath, lockPath);
        const runtimeOwner = readRuntimeOwner(runtimePath);
        if (
          runtimeOwner !== undefined &&
          runtimeOwner.pid !== pid &&
          isRuntimeOwnerRunning(runtimeOwner, running, identify)
        ) {
          NodeFS.rmSync(lockPath, { force: true });
          return {
            status: "occupied",
            displayName: "another T3/T4 Code server",
            pid: runtimeOwner.pid,
          };
        }
        return {
          status: "acquired",
          release: () => {
            if (readLockOwner(lockPath)?.token === token) {
              NodeFS.rmSync(lockPath, { force: true });
            }
          },
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      }

      const existingOwner = readLockOwner(lockPath);
      if (existingOwner !== undefined && isOwnerRunning(existingOwner, running, identify)) {
        return existingOwner.displayName === displayName
          ? { status: "same-application" }
          : {
              status: "occupied",
              displayName: existingOwner.displayName,
              pid: existingOwner.pid,
            };
      }
      if (existingOwner === undefined && isRecentDirectory(lockPath, now())) {
        return { status: "occupied", displayName: "another T3/T4 Code instance", pid: null };
      }

      try {
        NodeFS.mkdirSync(reclaimPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (isRecentDirectory(reclaimPath, now())) {
          return { status: "occupied", displayName: "another T3/T4 Code instance", pid: null };
        }
        NodeFS.rmSync(reclaimPath, { recursive: true, force: true });
        continue;
      }
      try {
        const ownerAfterClaim = readLockOwner(lockPath);
        if (ownerAfterClaim !== undefined && isOwnerRunning(ownerAfterClaim, running, identify)) {
          return ownerAfterClaim.displayName === displayName
            ? { status: "same-application" }
            : {
                status: "occupied",
                displayName: ownerAfterClaim.displayName,
                pid: ownerAfterClaim.pid,
              };
        }
        if (ownerAfterClaim === undefined && isRecentDirectory(lockPath, now())) {
          return { status: "occupied", displayName: "another T3/T4 Code instance", pid: null };
        }
        NodeFS.rmSync(lockPath, { force: true });
      } finally {
        NodeFS.rmSync(reclaimPath, { recursive: true, force: true });
      }
    }

    return { status: "occupied", displayName: "another T3/T4 Code instance", pid: null };
  } finally {
    NodeFS.rmSync(candidatePath, { force: true });
  }
}
