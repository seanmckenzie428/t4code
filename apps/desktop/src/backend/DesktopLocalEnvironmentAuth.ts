import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  RemoteEnvironmentAuthTimeoutError,
} from "@t3tools/client-runtime/authorization";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuthStore from "./DesktopLocalEnvironmentAuthStore.ts";

// The primary server can advertise its readiness before its OAuth exchange is
// schedulable during a cold boot. Retrying only that timeout keeps the renderer
// from failing its first data load and presenting an empty desktop window.
const LOCAL_BEARER_SESSION_MAX_ATTEMPTS = 5;
const LOCAL_BEARER_SESSION_RETRY_DELAY_MS = 250;

export class DesktopLocalEnvironmentAuthBackendNotConfiguredError extends Schema.TaggedError<DesktopLocalEnvironmentAuthBackendNotConfiguredError>()(
  "DesktopLocalEnvironmentAuthBackendNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Local backend is not configured.";
  }
}

export class DesktopLocalEnvironmentAuthSessionBootstrapError extends Schema.TaggedError<DesktopLocalEnvironmentAuthSessionBootstrapError>()(
  "DesktopLocalEnvironmentAuthSessionBootstrapError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the local desktop bearer session.";
  }
}

export const DesktopLocalEnvironmentAuthError = Schema.Union([
  DesktopLocalEnvironmentAuthBackendNotConfiguredError,
  DesktopLocalEnvironmentAuthSessionBootstrapError,
]);
export type DesktopLocalEnvironmentAuthError = typeof DesktopLocalEnvironmentAuthError.Type;

export class DesktopLocalEnvironmentAuth extends Context.Service<
  DesktopLocalEnvironmentAuth,
  {
    readonly getBearerToken: Effect.Effect<string, DesktopLocalEnvironmentAuthError>;
  }
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const httpClient = yield* HttpClient.HttpClient;
  const store = yield* DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore;
  const tokenRef = yield* Ref.make(Option.none<string>());
  const mutex = yield* Semaphore.make(1);

  const getBearerToken = mutex
    .withPermits(1)(
      Effect.gen(function* () {
        const cached = yield* Ref.get(tokenRef);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        const instances = yield* pool.list;
        const primary = instances.find((instance) => instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID);
        const configOption = primary === undefined ? Option.none() : yield* primary.currentConfig;
        if (Option.isNone(configOption)) {
          return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
        }
        const config = configOption.value;
        const persistedToken = yield* store.get.pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not restore the desktop local bearer session.", {
              error,
            }).pipe(Effect.as(Option.none<string>())),
          ),
        );
        if (Option.isSome(persistedToken)) {
          const sessionState = yield* fetchRemoteSessionState({
            httpBaseUrl: config.httpBaseUrl.href,
            bearerToken: persistedToken.value,
          }).pipe(
            Effect.retry({
              schedule: Schedule.spaced(Duration.millis(LOCAL_BEARER_SESSION_RETRY_DELAY_MS)).pipe(
                Schedule.upTo({ times: LOCAL_BEARER_SESSION_MAX_ATTEMPTS - 1 }),
              ),
              while: (error) => error instanceof RemoteEnvironmentAuthTimeoutError,
            }),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.option,
          );
          if (Option.isSome(sessionState) && sessionState.value.authenticated) {
            yield* Ref.set(tokenRef, persistedToken);
            return persistedToken.value;
          }
          yield* store.clear;
        }

        const credential = config.bootstrap.desktopBootstrapToken;
        if (!credential) {
          return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
        }
        const session = yield* bootstrapRemoteBearerSession({
          httpBaseUrl: config.httpBaseUrl.href,
          credential,
          clientMetadata: {
            label: "Pilot Desktop",
            deviceType: "desktop",
          },
        }).pipe(
          Effect.retry({
            schedule: Schedule.spaced(Duration.millis(LOCAL_BEARER_SESSION_RETRY_DELAY_MS)).pipe(
              Schedule.upTo({ times: LOCAL_BEARER_SESSION_MAX_ATTEMPTS - 1 }),
            ),
            while: (error) => error instanceof RemoteEnvironmentAuthTimeoutError,
          }),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError(
            (cause) =>
              new DesktopLocalEnvironmentAuthSessionBootstrapError({
                cause,
              }),
          ),
        );
        yield* Ref.set(tokenRef, Option.some(session.access_token));
        yield* store.set(session.access_token).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not persist the desktop local bearer session.", {
              error,
            }).pipe(Effect.as(false)),
          ),
        );
        return session.access_token;
      }),
    )
    .pipe(Effect.withSpan("desktop.localEnvironmentAuth.getBearerToken"));

  return DesktopLocalEnvironmentAuth.of({ getBearerToken });
});

export const layer = Layer.effect(DesktopLocalEnvironmentAuth, make);
