// @effect-diagnostics nodeBuiltinImport:off -- Chromium profile copying must finish before Clerk registers its privileged scheme, without yielding to Electron's ready event.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronApp from "../electron/ElectronApp.ts";

export class DesktopUserDataInUseError extends Schema.TaggedError<DesktopUserDataInUseError>()(
  "DesktopUserDataInUseError",
  { sourcePath: Schema.String },
) {
  override get message() {
    return `Quit the older T3/Pilot app before importing its browser data from ${this.sourcePath}.`;
  }
}

export class DesktopUserDataMigrationError extends Schema.TaggedError<DesktopUserDataMigrationError>()(
  "DesktopUserDataMigrationError",
  {
    sourcePath: Schema.String,
    destinationPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not copy browser data from ${this.sourcePath} to ${this.destinationPath}. The original profile is unchanged.`;
  }
}

const disposableEntries = new Set([
  "LOCK",
  "lockfile",
  "DevToolsActivePort",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
  "Crashpad",
  "Crash Reports",
  "BrowserMetrics",
]);

const copyProfile = (sourcePath: string, destinationPath: string) => {
  if (!NodeFS.lstatSync(sourcePath).isDirectory()) {
    throw new Error("The source browser profile must be a directory, not a symlink or file.");
  }
  const stagingPath = NodeFS.mkdtempSync(`${destinationPath}.migration-`);
  try {
    NodeFS.cpSync(sourcePath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (entryPath) => {
        const name = NodePath.basename(entryPath);
        if (name.startsWith("Singleton") || disposableEntries.has(name)) return false;
        const entry = NodeFS.lstatSync(entryPath);
        if (entry.isSymbolicLink()) {
          throw new Error(`The browser profile contains a symlink at ${entryPath}.`);
        }
        return entry.isDirectory() || entry.isFile();
      },
    });
    if (NodeFS.lstatSync(destinationPath, { throwIfNoEntry: false }) !== undefined) {
      throw new Error("The destination browser profile appeared during migration.");
    }
    // A complete profile is published at once. An existing nonempty destination
    // makes rename fail, rather than merging into another app's open databases.
    NodeFS.renameSync(stagingPath, destinationPath);
  } finally {
    NodeFS.rmSync(stagingPath, { recursive: true, force: true });
  }
};

/** Copy once under the old profile's Electron lock, before Clerk opens the new profile. */
export const migrateLegacyUserData = Effect.fn("desktop.userData.migrateLegacyUserData")(
  function* (input: { readonly appDataDirectory: string; readonly isDevelopment: boolean }) {
    if (input.isDevelopment) return;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const destinationPath = path.join(input.appDataDirectory, "t3code-v2");
    const inspect = (sourcePath: string) =>
      fs
        .exists(sourcePath)
        .pipe(
          Effect.mapError(
            (cause) => new DesktopUserDataMigrationError({ sourcePath, destinationPath, cause }),
          ),
        );
    // Never replace or merge a profile already opened by V2.
    if (yield* inspect(destinationPath)) return;
    const legacyPath = path.join(input.appDataDirectory, "T3 Code (Alpha)");
    const sourcePath = (yield* inspect(legacyPath))
      ? legacyPath
      : path.join(input.appDataDirectory, "t3code");
    if (!(yield* inspect(sourcePath))) return;

    const app = yield* ElectronApp.ElectronApp;
    yield* app.setPath("userData", sourcePath);
    if (!(yield* app.requestSingleInstanceLock)) {
      return yield* new DesktopUserDataInUseError({ sourcePath });
    }
    yield* Effect.try({
      try: () => copyProfile(sourcePath, destinationPath),
      catch: (cause) => new DesktopUserDataMigrationError({ sourcePath, destinationPath, cause }),
    }).pipe(Effect.ensuring(app.releaseSingleInstanceLock));
  },
);
