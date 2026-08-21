import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const DesktopLocalEnvironmentAuthDocument = Schema.Struct({
  version: Schema.Literal(1),
  encryptedBearerToken: Schema.String,
});
type DesktopLocalEnvironmentAuthDocument = typeof DesktopLocalEnvironmentAuthDocument.Type;

const DesktopLocalEnvironmentAuthDocumentJson = fromLenientJson(
  DesktopLocalEnvironmentAuthDocument,
);
const decodeDesktopLocalEnvironmentAuthDocument = Schema.decodeEffect(
  DesktopLocalEnvironmentAuthDocumentJson,
);
const encodeDesktopLocalEnvironmentAuthDocument = Schema.encodeEffect(
  DesktopLocalEnvironmentAuthDocumentJson,
);

const DesktopLocalEnvironmentAuthStoreOperation = Schema.Literals([
  "read",
  "decode",
  "check-encryption-availability",
  "decrypt",
  "encrypt",
  "encode",
  "create-temporary-file-name",
  "create-directory",
  "write-temporary-file",
  "replace-file",
]);

export class DesktopLocalEnvironmentAuthStoreError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthStoreError>()(
  "DesktopLocalEnvironmentAuthStoreError",
  {
    operation: DesktopLocalEnvironmentAuthStoreOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop local auth storage failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopLocalEnvironmentAuthStore extends Context.Service<
  DesktopLocalEnvironmentAuthStore,
  {
    readonly get: Effect.Effect<Option.Option<string>, DesktopLocalEnvironmentAuthStoreError>;
    readonly set: (
      bearerToken: string,
    ) => Effect.Effect<boolean, DesktopLocalEnvironmentAuthStoreError>;
    readonly clear: Effect.Effect<void>;
  }
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuthStore") {}

const storeError = (
  operation: typeof DesktopLocalEnvironmentAuthStoreOperation.Type,
  path: string,
  cause: unknown,
) => new DesktopLocalEnvironmentAuthStoreError({ operation, path, cause });

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const crypto = yield* Crypto.Crypto;
  const storePath = path.join(environment.stateDir, "desktop-local-auth.json");

  const readDocument = fileSystem.readFileString(storePath).pipe(
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed<string | null>(null)
        : Effect.fail(storeError("read", storePath, error)),
    ),
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed(Option.none<DesktopLocalEnvironmentAuthDocument>())
        : decodeDesktopLocalEnvironmentAuthDocument(raw).pipe(
            Effect.map(Option.some),
            Effect.mapError((cause) => storeError("decode", storePath, cause)),
          ),
    ),
  );

  const encryptionAvailable = safeStorage.isEncryptionAvailable.pipe(
    Effect.mapError((cause) => storeError("check-encryption-availability", storePath, cause)),
  );

  return DesktopLocalEnvironmentAuthStore.of({
    get: Effect.gen(function* () {
      const document = yield* readDocument;
      if (Option.isNone(document) || !(yield* encryptionAvailable)) {
        return Option.none<string>();
      }
      const encrypted = yield* Effect.fromResult(
        Encoding.decodeBase64(document.value.encryptedBearerToken),
      ).pipe(Effect.mapError((cause) => storeError("decode", storePath, cause)));
      return Option.some(
        yield* safeStorage
          .decryptString(encrypted)
          .pipe(Effect.mapError((cause) => storeError("decrypt", storePath, cause))),
      );
    }).pipe(Effect.withSpan("desktop.localEnvironmentAuthStore.get")),
    set: Effect.fn("desktop.localEnvironmentAuthStore.set")(function* (bearerToken) {
      if (!(yield* encryptionAvailable)) {
        return false;
      }
      const encryptedBearerToken = Encoding.encodeBase64(
        yield* safeStorage
          .encryptString(bearerToken)
          .pipe(Effect.mapError((cause) => storeError("encrypt", storePath, cause))),
      );
      const encoded = yield* encodeDesktopLocalEnvironmentAuthDocument({
        version: 1,
        encryptedBearerToken,
      }).pipe(Effect.mapError((cause) => storeError("encode", storePath, cause)));
      const suffix = (yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => storeError("create-temporary-file-name", storePath, cause)),
      )).replace(/-/g, "");
      const directory = path.dirname(storePath);
      const temporaryPath = `${storePath}.${process.pid}.${suffix}.tmp`;
      yield* fileSystem
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.mapError((cause) => storeError("create-directory", directory, cause)));
      yield* Effect.gen(function* () {
        yield* fileSystem
          .writeFileString(temporaryPath, `${encoded}\n`)
          .pipe(
            Effect.mapError((cause) => storeError("write-temporary-file", temporaryPath, cause)),
          );
        yield* fileSystem
          .rename(temporaryPath, storePath)
          .pipe(Effect.mapError((cause) => storeError("replace-file", storePath, cause)));
      }).pipe(
        Effect.ensuring(
          fileSystem.remove(temporaryPath, { force: true }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not remove temporary desktop auth file.", {
                temporaryPath,
                error,
              }),
            ),
          ),
        ),
      );
      return true;
    }),
    clear: fileSystem.remove(storePath, { force: true }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not clear desktop local auth storage.", {
          storePath,
          error,
        }),
      ),
      Effect.withSpan("desktop.localEnvironmentAuthStore.clear"),
    ),
  });
});

export const layer = Layer.effect(DesktopLocalEnvironmentAuthStore, make);

export const layerTest = (initialToken?: string) =>
  Layer.effect(
    DesktopLocalEnvironmentAuthStore,
    Effect.gen(function* () {
      const tokenRef = yield* Ref.make(Option.fromNullishOr(initialToken));
      return DesktopLocalEnvironmentAuthStore.of({
        get: Ref.get(tokenRef),
        set: (bearerToken) => Ref.set(tokenRef, Option.some(bearerToken)).pipe(Effect.as(true)),
        clear: Ref.set(tokenRef, Option.none()),
      });
    }),
  );
