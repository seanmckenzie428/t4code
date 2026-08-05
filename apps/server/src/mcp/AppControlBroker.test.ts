import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AppActionId,
  AppCommandId,
  AppControlClientId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AppControlHost,
  type AppControlRequest,
  type AppControlStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as AppControlBroker from "./AppControlBroker.ts";

const commandId = AppCommandId.make("thread.rename");
const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  principal: {
    kind: "thread-agent" as const,
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
  },
  capabilities: new Set(["preview", "app-control"] as const),
  grants: new Set(["thread:mutate"]),
  issuedAt: 1,
};

const makeBroker = AppControlBroker.make.pipe(Effect.provide(NodeServices.layer));
const makeHost = (clientId = "client-1"): AppControlHost => ({
  clientId: AppControlClientId.make(clientId),
  environmentId: scope.environmentId,
  supportedCommandIds: [commandId],
});

const requestsFrom = (
  events: Stream.Stream<AppControlStreamEvent>,
  onConnected: (connectionId: AppControlStreamEvent["connectionId"]) => void = () => {},
): Stream.Stream<{
  readonly connectionId: AppControlStreamEvent["connectionId"];
  readonly request: AppControlRequest;
}> =>
  events.pipe(
    Stream.filterMap((event) => {
      if (event.type === "connected") {
        onConnected(event.connectionId);
        return Result.failVoid;
      }
      return Result.succeed({ connectionId: event.connectionId, request: event.request });
    }),
  );

it.effect("routes a semantic command to a capable environment host", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const events = yield* broker.connect(makeHost());
      yield* Stream.runForEach(requestsFrom(events), ({ connectionId, request }) =>
        broker.respond({
          clientId: AppControlClientId.make("client-1"),
          connectionId,
          requestId: request.requestId,
          ok: true,
          result: { renamed: true },
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const result = yield* broker.invoke<{ renamed: boolean }>({
        scope,
        invocation: {
          actionId: AppActionId.make("action-1"),
          commandId,
          args: { title: "New name" },
        },
      });

      expect(result).toEqual({ renamed: true });
    }),
  ),
);

it.effect("returns typed unavailable when no host supports the command", () =>
  Effect.gen(function* () {
    const broker = yield* makeBroker;
    const error = yield* broker
      .invoke<void>({
        scope,
        invocation: {
          actionId: AppActionId.make("action-2"),
          commandId,
          args: {},
        },
      })
      .pipe(Effect.flip);

    expect(error).toMatchObject({ code: "unavailable", retryable: false });
  }),
);

it.effect("forwards a server-authored confirmation preview without changing its label", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const events = yield* broker.connect(makeHost());
      yield* Stream.runForEach(requestsFrom(events), ({ connectionId, request }) =>
        broker.respond({
          clientId: AppControlClientId.make("client-1"),
          connectionId,
          requestId: request.requestId,
          ok: true,
          result: {
            decision: request.confirmation?.title === "Delete Exact Thread" ? "allow" : "decline",
          },
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const result = yield* broker.invoke<{ readonly decision: string }>({
        scope,
        invocation: {
          actionId: AppActionId.make("action-confirm"),
          commandId,
          args: { title: "agent-controlled prose" },
        },
        confirmation: {
          title: "Delete Exact Thread",
          description: "This label came from server policy.",
          risk: "destructive",
          targetName: "Canonical thread name",
          environmentId: scope.environmentId,
          descendants: 0,
          recoverability: "Recovery is not guaranteed.",
          rememberAllowed: false,
        },
      });

      expect(result).toEqual({ decision: "allow" });
    }),
  ),
);

it.effect("clears a provider-session lease when its client disconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const firstEvents = yield* broker.connect(makeHost("client-1"));
      const firstConsumer = yield* Stream.runForEach(
        requestsFrom(firstEvents),
        ({ connectionId, request }) =>
          broker.respond({
            clientId: AppControlClientId.make("client-1"),
            connectionId,
            requestId: request.requestId,
            ok: true,
            result: "first",
          }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(
        yield* broker.invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-3"),
            commandId,
            args: {},
          },
        }),
      ).toBe("first");

      yield* Fiber.interrupt(firstConsumer);
      yield* Effect.yieldNow;
      const secondEvents = yield* broker.connect(makeHost("client-2"));
      yield* Stream.runForEach(requestsFrom(secondEvents), ({ connectionId, request }) =>
        broker.respond({
          clientId: AppControlClientId.make("client-2"),
          connectionId,
          requestId: request.requestId,
          ok: true,
          result: "second",
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      expect(
        yield* broker.invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-4"),
            commandId,
            args: {},
          },
        }),
      ).toBe("second");
    }),
  ),
);

it.effect("hands future requests to the newly focused capable client", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      let firstConnectionId: AppControlStreamEvent["connectionId"] | undefined;
      let secondConnectionId: AppControlStreamEvent["connectionId"] | undefined;
      const firstEvents = yield* broker.connect(makeHost("client-1"));
      const secondEvents = yield* broker.connect(makeHost("client-2"));
      yield* Stream.runForEach(
        requestsFrom(firstEvents, (value) => {
          firstConnectionId = value;
        }),
        ({ connectionId, request }) =>
          broker.respond({
            clientId: AppControlClientId.make("client-1"),
            connectionId,
            requestId: request.requestId,
            ok: true,
            result: "first",
          }),
      ).pipe(Effect.forkScoped);
      yield* Stream.runForEach(
        requestsFrom(secondEvents, (value) => {
          secondConnectionId = value;
        }),
        ({ connectionId, request }) =>
          broker.respond({
            clientId: AppControlClientId.make("client-2"),
            connectionId,
            requestId: request.requestId,
            ok: true,
            result: "second",
          }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(firstConnectionId).toBeDefined();
      expect(secondConnectionId).toBeDefined();
      yield* broker.focusHost({
        ...makeHost("client-1"),
        connectionId: firstConnectionId!,
        focused: true,
      });

      expect(
        yield* broker.invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-focused-first"),
            commandId,
            args: {},
          },
        }),
      ).toBe("first");

      yield* broker.focusHost({
        ...makeHost("client-1"),
        connectionId: firstConnectionId!,
        focused: false,
      });
      yield* broker.focusHost({
        ...makeHost("client-2"),
        connectionId: secondConnectionId!,
        focused: true,
      });
      expect(
        yield* broker.invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-focused-second"),
            commandId,
            args: {},
          },
        }),
      ).toBe("second");
    }),
  ),
);

it.effect("moves a lease when its assigned client does not support the next command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const otherCommandId = AppCommandId.make("ui.files.open");
      const firstEvents = yield* broker.connect(makeHost("client-1"));
      const secondEvents = yield* broker.connect({
        ...makeHost("client-2"),
        supportedCommandIds: [otherCommandId],
      });
      yield* Stream.runForEach(requestsFrom(firstEvents), ({ connectionId, request }) =>
        broker.respond({
          clientId: AppControlClientId.make("client-1"),
          connectionId,
          requestId: request.requestId,
          ok: true,
          result: "first",
        }),
      ).pipe(Effect.forkScoped);
      yield* Stream.runForEach(requestsFrom(secondEvents), ({ connectionId, request }) =>
        broker.respond({
          clientId: AppControlClientId.make("client-2"),
          connectionId,
          requestId: request.requestId,
          ok: true,
          result: "second",
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      expect(
        yield* broker.invoke({
          scope,
          invocation: { actionId: AppActionId.make("action-first"), commandId, args: {} },
        }),
      ).toBe("first");
      expect(
        yield* broker.invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-other"),
            commandId: otherCommandId,
            args: {},
          },
        }),
      ).toBe("second");
    }),
  ),
);

it.effect("interrupts a pending request when its provider session is revoked", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const events = yield* broker.connect(makeHost());
      const nextRequest = yield* Stream.runHead(requestsFrom(events)).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const invocation = yield* broker
        .invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-revoked"),
            commandId,
            args: {},
          },
        })
        .pipe(Effect.result, Effect.forkScoped);
      yield* Fiber.join(nextRequest);
      yield* broker.cancelProviderSession(scope.providerSessionId);

      expect(yield* Fiber.join(invocation)).toMatchObject({
        _tag: "Failure",
        failure: { code: "disconnected" },
      });
    }),
  ),
);

it.effect("fails a pending client request when its focused host disconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const received = yield* Deferred.make<void>();
      const events = yield* broker.connect(makeHost());
      const consumer = yield* Stream.runForEach(requestsFrom(events), () =>
        Deferred.succeed(received, undefined),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const invocation = yield* broker
        .invoke({
          scope,
          invocation: {
            actionId: AppActionId.make("action-disconnected"),
            commandId,
            args: {},
          },
        })
        .pipe(Effect.result, Effect.forkScoped);
      yield* Deferred.await(received);
      yield* Fiber.interrupt(consumer);

      expect(yield* Fiber.join(invocation)).toMatchObject({
        _tag: "Failure",
        failure: { code: "disconnected", retryable: true },
      });
    }),
  ),
);
