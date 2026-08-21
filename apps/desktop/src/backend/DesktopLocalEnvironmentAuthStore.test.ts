import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopLocalEnvironmentAuthStore from "./DesktopLocalEnvironmentAuthStore.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function makeSafeStorageLayer(available: boolean) {
  return Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.succeed(available),
    encryptString: (value) => Effect.succeed(textEncoder.encode(`encrypted:${value}`)),
    decryptString: (value) => {
      const decoded = textDecoder.decode(value);
      return decoded.startsWith("encrypted:")
        ? Effect.succeed(decoded.slice("encrypted:".length))
        : Effect.fail(
            new ElectronSafeStorage.ElectronSafeStorageDecryptError({
              cause: new Error("invalid encrypted token"),
            }),
          );
    },
    selectedStorageBackend: Effect.succeed(Option.none()),
  } satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);
}

function makeLayer(baseDir: string, encryptionAvailable: boolean) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  return DesktopLocalEnvironmentAuthStore.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(makeSafeStorageLayer(encryptionAvailable)),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withStore = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore
  >,
  encryptionAvailable = true,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t4-desktop-local-auth-test-",
    });
    return yield* effect.pipe(Effect.provide(makeLayer(baseDir, encryptionAvailable)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopLocalEnvironmentAuthStore", () => {
  it.effect("persists, reads, and clears an encrypted bearer token", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore;

        assert.isTrue(yield* store.set("desktop-bearer-token"));
        assert.deepStrictEqual(yield* store.get, Option.some("desktop-bearer-token"));

        yield* store.clear;
        assert.deepStrictEqual(yield* store.get, Option.none());
      }),
    ),
  );

  it.effect("does not persist when secure storage is unavailable", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore;
        assert.isFalse(yield* store.set("desktop-bearer-token"));
        assert.deepStrictEqual(yield* store.get, Option.none());
      }),
      false,
    ),
  );
});
