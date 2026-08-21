import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./DesktopLocalEnvironmentAuth.ts";
import * as DesktopLocalEnvironmentAuthStore from "./DesktopLocalEnvironmentAuthStore.ts";

const config = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: {},
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "desktop-bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

describe("DesktopLocalEnvironmentAuth", () => {
  it.effect("exchanges the desktop bootstrap credential only once", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({
                    access_token: "desktop-bearer-token",
                    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                    token_type: "Bearer",
                    expires_in: 3600,
                    scope: "orchestration:read",
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                ),
              ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Windows"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(
          Layer.mergeAll(poolLayer, httpClientLayer, DesktopLocalEnvironmentAuthStore.layerTest()),
        ),
      );

      const [first, second] = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* Effect.all([auth.getBearerToken, auth.getBearerToken]);
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(first, "desktop-bearer-token");
      assert.strictEqual(second, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("retries a cold-start OAuth timeout before returning the bearer token", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Effect.never
                : Effect.succeed(
                    HttpClientResponse.fromWeb(
                      request,
                      new Response(
                        JSON.stringify({
                          access_token: "desktop-bearer-token",
                          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                          token_type: "Bearer",
                          expires_in: 3600,
                          scope: "orchestration:read",
                        }),
                        { status: 200, headers: { "content-type": "application/json" } },
                      ),
                    ),
                  ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Windows"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(
          Layer.mergeAll(poolLayer, httpClientLayer, DesktopLocalEnvironmentAuthStore.layerTest()),
        ),
      );

      const bearerTokenFiber = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* auth.getBearerToken.pipe(Effect.forkChild);
      }).pipe(Effect.provide(testLayer));
      yield* TestClock.adjust(10_250);
      const bearerToken = yield* Fiber.join(bearerTokenFiber);

      assert.strictEqual(bearerToken, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 2);
    }),
  );

  it.effect("reuses a persisted bearer session across desktop launches", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyArray<HttpClientRequest.HttpClientRequest>>([]);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requests, (current) => [...current, request]).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                Response.json({
                  authenticated: true,
                  auth: {
                    policy: "desktop-managed-local",
                    bootstrapMethods: ["desktop-bootstrap"],
                    sessionMethods: ["bearer-access-token"],
                    sessionCookieName: "t3_session",
                  },
                  scopes: ["orchestration:read"],
                  sessionMethod: "bearer-access-token",
                  expiresAt: "2026-09-20T00:00:00.000Z",
                }),
              ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Mac"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            poolLayer,
            httpClientLayer,
            DesktopLocalEnvironmentAuthStore.layerTest("persisted-desktop-token"),
          ),
        ),
      );

      const token = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* auth.getBearerToken;
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(token, "persisted-desktop-token");
      const recorded = yield* Ref.get(requests);
      assert.strictEqual(recorded.length, 1);
      assert.strictEqual(recorded[0]?.method, "GET");
      assert.strictEqual(recorded[0]?.headers.authorization, "Bearer persisted-desktop-token");
    }),
  );

  it.effect("replaces an invalid persisted bearer session", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
            Effect.map((count) =>
              HttpClientResponse.fromWeb(
                request,
                count === 1
                  ? Response.json({
                      authenticated: false,
                      auth: {
                        policy: "desktop-managed-local",
                        bootstrapMethods: ["desktop-bootstrap"],
                        sessionMethods: ["bearer-access-token"],
                        sessionCookieName: "t3_session",
                      },
                    })
                  : Response.json({
                      access_token: "replacement-desktop-token",
                      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                      token_type: "Bearer",
                      expires_in: 3600,
                      scope: "orchestration:read",
                    }),
              ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Mac"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const storedToken = yield* Ref.make(Option.some("invalid-desktop-token"));
      const tokenStoreLayer = Layer.succeed(
        DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore,
        DesktopLocalEnvironmentAuthStore.DesktopLocalEnvironmentAuthStore.of({
          get: Ref.get(storedToken),
          set: (bearerToken) =>
            Ref.set(storedToken, Option.some(bearerToken)).pipe(Effect.as(true)),
          clear: Ref.set(storedToken, Option.none()),
        }),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(poolLayer, httpClientLayer, tokenStoreLayer)),
      );

      const token = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* auth.getBearerToken;
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(token, "replacement-desktop-token");
      assert.strictEqual(yield* Ref.get(requestCount), 2);
      assert.deepStrictEqual(yield* Ref.get(storedToken), Option.some("replacement-desktop-token"));
    }),
  );
});
