// @effect-diagnostics nodeBuiltinImport:off -- These tests assert profile migration completes synchronously before Electron ready.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as EffectNodePath from "@effect/platform-node/NodePath";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopPreReadyFileSystem from "./DesktopPreReadyFileSystem.ts";
import {
  DesktopUserDataInUseError,
  DesktopUserDataMigrationError,
  migrateLegacyUserData,
} from "./DesktopUserDataMigration.ts";

const writeFiles = (directory: string, files: Record<string, string>) => {
  for (const [name, contents] of Object.entries(files)) {
    const destination = NodePath.join(directory, name);
    NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
    NodeFS.writeFileSync(destination, contents);
  }
};

describe("DesktopUserDataMigration", () => {
  let root: string;
  let events: string[];
  let acquireLock: () => boolean;

  beforeEach(() => {
    root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pilot-profile-migration-"));
    events = [];
    acquireLock = () => true;
  });

  afterEach(() => {
    NodeFS.rmSync(root, { recursive: true, force: true });
  });

  const runMigration = (isDevelopment = false) => {
    // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- runSync proves no asynchronous boundary lets Electron emit ready during migration.
    return Effect.runSync(
      migrateLegacyUserData({ appDataDirectory: root, isDevelopment }).pipe(
        Effect.result,
        Effect.provideService(ElectronApp.ElectronApp, {
          ...ElectronApp.make,
          setPath: (_, path) =>
            Effect.sync(() => {
              events.push(`profile:${path}`);
            }),
          requestSingleInstanceLock: Effect.sync(() => {
            events.push("lock");
            return acquireLock();
          }),
          releaseSingleInstanceLock: Effect.sync(() => {
            events.push("release");
          }),
        }),
        Effect.provide(Layer.mergeAll(DesktopPreReadyFileSystem.layer, EffectNodePath.layer)),
      ),
    );
  };

  for (const sourceName of ["T3 Code (Alpha)", "t3code"]) {
    it(`copies persistent browser data from ${sourceName} once and preserves the original`, () => {
      const source = NodePath.join(root, sourceName);
      const destination = NodePath.join(root, "t3code-v2");
      const files = {
        "Local State": '{"os_crypt":{"encrypted_key":"existing-key"}}',
        Preferences: "preferences",
        "Local Storage/leveldb/000001.log": "drafts and settings",
        "IndexedDB/t3code_app_0.indexeddb.leveldb/000001.log": "client state",
        "Network/Cookies": "cookies",
        "Partitions/t3code-preview-profile-test/Network/Cookies": "preview cookies",
      };
      writeFiles(source, files);
      writeFiles(source, {
        SingletonLock: "old process",
        SingletonCookie: "old cookie",
        lockfile: "old lock",
        DevToolsActivePort: "port",
        "Local Storage/leveldb/LOCK": "database lock",
        "Cache/Cache_Data/data_0": "http cache",
        "Code Cache/js/cache": "compiled cache",
        "Partitions/t3code-preview-profile-test/GPUCache/data": "gpu cache",
      });

      expect(runMigration()._tag).toBe("Success");

      for (const [name, contents] of Object.entries(files)) {
        expect(NodeFS.readFileSync(NodePath.join(destination, name), "utf8")).toBe(contents);
        expect(NodeFS.readFileSync(NodePath.join(source, name), "utf8")).toBe(contents);
      }
      for (const name of [
        "SingletonLock",
        "SingletonCookie",
        "lockfile",
        "DevToolsActivePort",
        "Local Storage/leveldb/LOCK",
        "Cache",
        "Code Cache",
        "Partitions/t3code-preview-profile-test/GPUCache",
      ]) {
        expect(NodeFS.existsSync(NodePath.join(destination, name))).toBe(false);
      }
      expect(events).toEqual([`profile:${source}`, "lock", "release"]);
      writeFiles(source, { Preferences: "later old profile changes" });

      expect(runMigration()._tag).toBe("Success");
      expect(NodeFS.readFileSync(NodePath.join(destination, "Preferences"), "utf8")).toBe(
        "preferences",
      );
      expect(events).toHaveLength(3);
      expect(NodeFS.readdirSync(root).sort()).toEqual([sourceName, "t3code-v2"].sort());
    });
  }

  it("uses the same legacy source precedence as the prior profile resolver", () => {
    writeFiles(NodePath.join(root, "T3 Code (Alpha)"), { Preferences: "alpha" });
    writeFiles(NodePath.join(root, "t3code"), { Preferences: "stable" });

    expect(runMigration()._tag).toBe("Success");
    expect(NodeFS.readFileSync(NodePath.join(root, "t3code-v2", "Preferences"), "utf8")).toBe(
      "alpha",
    );
  });

  it("stops when the old profile is open without creating a new profile", () => {
    const source = NodePath.join(root, "t3code");
    writeFiles(source, { Preferences: "original" });
    acquireLock = () => false;

    const result = runMigration();

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(DesktopUserDataInUseError);
    expect(NodeFS.readdirSync(root)).toEqual(["t3code"]);
    expect(events).toEqual([`profile:${source}`, "lock"]);
  });

  it("preserves a destination created during copying and cleans incomplete staging", () => {
    const source = NodePath.join(root, "t3code");
    const destination = NodePath.join(root, "t3code-v2");
    writeFiles(source, { Preferences: "original" });
    acquireLock = () => {
      writeFiles(destination, { Preferences: "another instance" });
      return true;
    };

    const result = runMigration();

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure).toBeInstanceOf(DesktopUserDataMigrationError);
    expect(NodeFS.readFileSync(NodePath.join(destination, "Preferences"), "utf8")).toBe(
      "another instance",
    );
    expect(NodeFS.readFileSync(NodePath.join(source, "Preferences"), "utf8")).toBe("original");
    expect(NodeFS.readdirSync(root).sort()).toEqual(["t3code", "t3code-v2"]);
    expect(events).toEqual([`profile:${source}`, "lock", "release"]);
  });

  it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "fails closed on a symlinked source and releases its lock",
    () => {
      const source = NodePath.join(root, "t3code");
      writeFiles(NodePath.join(root, "original"), { Preferences: "original" });
      NodeFS.symlinkSync(NodePath.join(root, "original"), source, "dir");

      const result = runMigration();

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure).toBeInstanceOf(DesktopUserDataMigrationError);
      expect(NodeFS.existsSync(NodePath.join(root, "t3code-v2"))).toBe(false);
      expect(events).toEqual([`profile:${source}`, "lock", "release"]);
    },
  );

  it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "fails closed instead of silently omitting symlinked persistent storage",
    () => {
      const source = NodePath.join(root, "t3code");
      writeFiles(source, { Preferences: "original" });
      writeFiles(NodePath.join(root, "linked-storage"), { "000001.log": "draft" });
      NodeFS.symlinkSync(
        NodePath.join(root, "linked-storage"),
        NodePath.join(source, "Local Storage"),
        "dir",
      );

      const result = runMigration();

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure).toBeInstanceOf(DesktopUserDataMigrationError);
      expect(NodeFS.existsSync(NodePath.join(root, "t3code-v2"))).toBe(false);
      expect(NodeFS.readdirSync(root).sort()).toEqual(["linked-storage", "t3code"]);
      expect(events).toEqual([`profile:${source}`, "lock", "release"]);
    },
  );

  it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "preserves a dangling destination symlink rather than publishing over it",
    () => {
      const source = NodePath.join(root, "t3code");
      const destination = NodePath.join(root, "t3code-v2");
      writeFiles(source, { Preferences: "original" });
      NodeFS.symlinkSync(NodePath.join(root, "missing-profile"), destination, "dir");

      const result = runMigration();

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure).toBeInstanceOf(DesktopUserDataMigrationError);
      expect(NodeFS.lstatSync(destination).isSymbolicLink()).toBe(true);
      expect(NodeFS.existsSync(NodePath.join(root, "missing-profile"))).toBe(false);
      expect(NodeFS.readdirSync(root).sort()).toEqual(["t3code", "t3code-v2"]);
      expect(events).toEqual([`profile:${source}`, "lock", "release"]);
    },
  );

  it("leaves development profiles alone", () => {
    writeFiles(NodePath.join(root, "T3 Code (Dev)"), { Preferences: "dev" });
    writeFiles(NodePath.join(root, "t3code"), { Preferences: "production" });

    expect(runMigration(true)._tag).toBe("Success");
    expect(NodeFS.existsSync(NodePath.join(root, "t3code-v2"))).toBe(false);
    expect(events).toEqual([]);
  });

  it("leaves fresh installations to normal startup", () => {
    expect(runMigration()._tag).toBe("Success");
    expect(NodeFS.readdirSync(root)).toEqual([]);
    expect(events).toEqual([]);
  });
});
