import {
  AppActionId,
  AppCommandId,
  AppControlClientId,
  AppControlConnectionId,
  type AppCommandInvocation,
  type AppControlError,
  type AppControlHost,
  type AppControlHostFocus,
  type AppControlRequest,
  type AppControlResponse,
  type AppControlStreamEvent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import type * as McpInvocationContext from "./McpInvocationContext.ts";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface AppControlInvokeInput {
  readonly scope: McpInvocationContext.McpInvocationScope & {
    readonly principal: NonNullable<McpInvocationContext.McpInvocationScope["principal"]>;
  };
  readonly invocation: AppCommandInvocation;
  readonly timeoutMs?: number;
  readonly confirmation?: NonNullable<AppControlRequest["confirmation"]>;
}

export class AppControlBroker extends Context.Service<
  AppControlBroker,
  {
    readonly connect: (host: AppControlHost) => Effect.Effect<Stream.Stream<AppControlStreamEvent>>;
    readonly focusHost: (host: AppControlHostFocus) => Effect.Effect<void>;
    readonly respond: (response: AppControlResponse) => Effect.Effect<void>;
    readonly cancelProviderSession: (providerSessionId: string) => Effect.Effect<void>;
    readonly cancelThread: (threadId: string) => Effect.Effect<void>;
    readonly cancelAll: Effect.Effect<void>;
    readonly invoke: <A = unknown>(
      input: AppControlInvokeInput,
    ) => Effect.Effect<A, AppControlError>;
  }
>()("t3/mcp/AppControlBroker") {}

interface ClientConnection {
  readonly clientId: AppControlClientId;
  readonly connectionId: AppControlConnectionId;
  readonly environmentId: AppControlHost["environmentId"];
  readonly supportedCommandIds: ReadonlySet<AppCommandId>;
  readonly focused: boolean;
  readonly focusOrder: number;
  readonly queue: Queue.Queue<AppControlStreamEvent>;
}

interface PendingRequest {
  readonly queue: ClientConnection["queue"];
  readonly clientId: AppControlClientId;
  readonly connectionId: AppControlConnectionId;
  readonly deferred: Deferred.Deferred<unknown, AppControlError>;
  readonly providerSessionId: string;
  readonly threadId: string;
}

interface HostAssignment {
  readonly clientId: AppControlClientId;
  readonly connectionId: AppControlConnectionId;
  readonly queue: ClientConnection["queue"];
}

interface BrokerState {
  readonly clients: ReadonlyMap<AppControlClientId, ClientConnection>;
  readonly assignments: ReadonlyMap<string, HostAssignment>;
  readonly pending: ReadonlyMap<string, PendingRequest>;
  readonly requestSequence: number;
  readonly focusSequence: number;
}

const controlError = (code: AppControlError["code"], message: string): AppControlError =>
  ({ code, message, retryable: code === "disconnected" || code === "timeout" }) as AppControlError;

const assignmentKey = (scope: AppControlInvokeInput["scope"]): string =>
  `${scope.environmentId}\u0000${scope.providerSessionId}`;

const removeConnection = (
  current: BrokerState,
  clientId: AppControlClientId,
  queue: ClientConnection["queue"],
) => {
  const clients = new Map(current.clients);
  const assignments = new Map(current.assignments);
  const pending = new Map(current.pending);
  const disconnected: PendingRequest[] = [];
  if (clients.get(clientId)?.queue === queue) clients.delete(clientId);
  for (const [key, assignment] of assignments) {
    if (assignment.queue === queue) assignments.delete(key);
  }
  for (const [requestId, request] of pending) {
    if (request.queue !== queue) continue;
    pending.delete(requestId);
    disconnected.push(request);
  }
  return {
    state: { ...current, clients, assignments, pending },
    disconnected,
  };
};

export const make = Effect.gen(function* AppControlBrokerMake() {
  const crypto = yield* Crypto.Crypto;
  const state = yield* SynchronizedRef.make<BrokerState>({
    clients: new Map(),
    assignments: new Map(),
    pending: new Map(),
    requestSequence: 0,
    focusSequence: 0,
  });

  const closeConnection = Effect.fn("AppControlBroker.closeConnection")(function* (
    connection: Pick<ClientConnection, "queue">,
    disconnected: ReadonlyArray<PendingRequest>,
  ) {
    yield* Effect.forEach(
      disconnected,
      ({ deferred }) =>
        Deferred.fail(
          deferred,
          controlError("disconnected", "Focused app-control client disconnected."),
        ),
      { discard: true },
    );
    yield* Queue.shutdown(connection.queue);
  });

  const disconnect = Effect.fn("AppControlBroker.disconnect")(function* (
    clientId: AppControlClientId,
    queue: ClientConnection["queue"],
  ) {
    const disconnected = yield* SynchronizedRef.modify(state, (current) => {
      const removed = removeConnection(current, clientId, queue);
      return [removed.disconnected, removed.state] as const;
    });
    yield* closeConnection({ queue }, disconnected);
  });

  const acquireConnection = Effect.fn("AppControlBroker.acquireConnection")(function* (
    host: AppControlHost,
  ) {
    const queue = yield* Queue.unbounded<AppControlStreamEvent>();
    const connectionId = AppControlConnectionId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const connection: ClientConnection = {
      clientId: AppControlClientId.make(host.clientId),
      connectionId,
      environmentId: host.environmentId,
      supportedCommandIds: new Set(host.supportedCommandIds ?? []),
      focused: false,
      focusOrder: 0,
      queue,
    };
    yield* Queue.offer(queue, { type: "connected", connectionId });
    const registration = yield* SynchronizedRef.modify(state, (current) => {
      const previous = current.clients.get(connection.clientId);
      const removed = previous
        ? removeConnection(current, connection.clientId, previous.queue)
        : { state: current, disconnected: [] };
      const clients = new Map(removed.state.clients);
      const focusSequence = removed.state.focusSequence + 1;
      const registered = { ...connection, focusOrder: focusSequence };
      clients.set(connection.clientId, registered);
      return [
        { previous, disconnected: removed.disconnected, registered },
        { ...removed.state, clients, focusSequence },
      ] as const;
    });
    if (registration.previous) {
      yield* closeConnection(registration.previous, registration.disconnected);
    }
    return registration.registered;
  });

  const connect: AppControlBroker["Service"]["connect"] = Effect.fn("AppControlBroker.connect")(
    (host) =>
      Effect.succeed(
        Stream.unwrap(
          Effect.acquireRelease(acquireConnection(host), (connection) =>
            disconnect(connection.clientId, connection.queue),
          ).pipe(Effect.map((connection) => Stream.fromQueue(connection.queue))),
        ),
      ),
  );

  const focusHost: AppControlBroker["Service"]["focusHost"] = Effect.fn(
    "AppControlBroker.focusHost",
  )(function* (host) {
    yield* SynchronizedRef.update(state, (current) => {
      const connection = current.clients.get(host.clientId);
      if (
        !connection ||
        connection.environmentId !== host.environmentId ||
        connection.connectionId !== host.connectionId
      ) {
        return current;
      }
      const clients = new Map(current.clients);
      const focusSequence = host.focused ? current.focusSequence + 1 : current.focusSequence;
      clients.set(host.clientId, {
        ...connection,
        focused: host.focused,
        focusOrder: host.focused ? focusSequence : connection.focusOrder,
      });
      return { ...current, clients, focusSequence };
    });
  });

  const respond: AppControlBroker["Service"]["respond"] = Effect.fn("AppControlBroker.respond")(
    function* (response) {
      const pending = yield* SynchronizedRef.modify(state, (current) => {
        const entry = current.pending.get(response.requestId);
        if (
          !entry ||
          entry.clientId !== response.clientId ||
          entry.connectionId !== response.connectionId
        ) {
          return [undefined, current] as const;
        }
        const next = new Map(current.pending);
        next.delete(response.requestId);
        return [entry, { ...current, pending: next }] as const;
      });
      if (!pending) return;
      if (response.ok) {
        yield* Deferred.succeed(
          pending.deferred,
          response.decision === undefined ? response.result : { decision: response.decision },
        );
      } else {
        yield* Deferred.fail(
          pending.deferred,
          response.error ??
            controlError("malformed-response", "Client returned no app-control error."),
        );
      }
    },
  );

  const cancelWhere = Effect.fn("AppControlBroker.cancelWhere")(function* (
    predicate: (request: PendingRequest) => boolean,
  ) {
    const cancelled = yield* SynchronizedRef.modify(state, (current) => {
      const pending = new Map(current.pending);
      const removed: PendingRequest[] = [];
      for (const [requestId, request] of pending) {
        if (!predicate(request)) continue;
        pending.delete(requestId);
        removed.push(request);
      }
      return [removed, { ...current, pending }] as const;
    });
    yield* Effect.forEach(
      cancelled,
      ({ deferred }) =>
        Deferred.fail(
          deferred,
          controlError("disconnected", "App-control provider session was revoked."),
        ),
      { discard: true },
    );
  });

  const cancelProviderSession = (providerSessionId: string) =>
    cancelWhere((request) => request.providerSessionId === providerSessionId);
  const cancelThread = (threadId: string) =>
    cancelWhere((request) => request.threadId === threadId);
  const cancelAll = cancelWhere(() => true);

  const invoke = Effect.fn("AppControlBroker.invoke")(function* <A = unknown>(
    input: AppControlInvokeInput,
  ): Effect.fn.Return<A, AppControlError> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deferred = yield* Deferred.make<unknown, AppControlError>();
    const route = yield* SynchronizedRef.modify(state, (current) => {
      const assignments = new Map(
        Array.from(current.assignments).filter(([, assignment]) => {
          const client = current.clients.get(assignment.clientId);
          return (
            client?.connectionId === assignment.connectionId && client.queue === assignment.queue
          );
        }),
      );
      const key = assignmentKey(input.scope);
      const assigned = assignments.get(key);
      const assignedClient = assigned ? current.clients.get(assigned.clientId) : undefined;
      const assignedIsLive =
        assignedClient?.environmentId === input.scope.environmentId &&
        assignedClient.connectionId === assigned?.connectionId &&
        assignedClient.queue === assigned?.queue;
      const supports = (client: ClientConnection) =>
        client.supportedCommandIds.has(input.invocation.commandId);
      const candidates = Array.from(current.clients.values())
        .filter((client) => client.environmentId === input.scope.environmentId && supports(client))
        .sort(
          (left, right) =>
            Number(right.focused) - Number(left.focused) || right.focusOrder - left.focusOrder,
        );
      const focusedCandidate = candidates.find((client) => client.focused);
      // Keep a live, focused lease stable for the provider session. If that
      // surface loses focus, hand future requests to the newest focused host;
      // already-routed requests remain correlated with their original host.
      const connection =
        assignedClient !== undefined &&
        assignedIsLive &&
        supports(assignedClient) &&
        (assignedClient.focused || focusedCandidate === undefined)
          ? assignedClient
          : (focusedCandidate ?? candidates[0]);
      if (!connection) {
        assignments.delete(key);
        return [undefined, { ...current, assignments }] as const;
      }
      assignments.set(key, {
        clientId: connection.clientId,
        connectionId: connection.connectionId,
        queue: connection.queue,
      });
      const requestId = `app-control-${current.requestSequence}`;
      const pending = new Map(current.pending);
      pending.set(requestId, {
        queue: connection.queue,
        clientId: connection.clientId,
        connectionId: connection.connectionId,
        deferred,
        providerSessionId: input.scope.providerSessionId,
        threadId: input.scope.threadId,
      });
      return [
        { connection, requestId },
        { ...current, assignments, pending, requestSequence: current.requestSequence + 1 },
      ] as const;
    });
    if (!route) {
      return yield* Effect.fail(
        controlError("unavailable", "No connected client supports this app command."),
      );
    }
    const request: AppControlRequest = {
      requestId: route.requestId,
      actionId: AppActionId.make(input.invocation.actionId),
      principal: input.scope.principal,
      commandId: AppCommandId.make(input.invocation.commandId),
      args: input.invocation.args,
      ...(input.invocation.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.invocation.expectedRevision }),
      timeoutMs,
      ...(input.confirmation === undefined ? {} : { confirmation: input.confirmation }),
    } as AppControlRequest;
    const removePending = SynchronizedRef.update(state, (current) => {
      if (!current.pending.has(route.requestId)) return current;
      const pending = new Map(current.pending);
      pending.delete(route.requestId);
      return { ...current, pending };
    });
    const result = yield* Effect.gen(function* () {
      const offered = yield* Queue.offer(route.connection.queue, {
        type: "request",
        connectionId: route.connection.connectionId,
        request,
      });
      if (!offered) {
        const completed = yield* Deferred.poll(deferred);
        if (Option.isSome(completed)) return yield* completed.value;
        return yield* Effect.fail(
          controlError("disconnected", "App-control request queue closed."),
        );
      }
      const completed = yield* Deferred.await(deferred).pipe(Effect.timeoutOption(timeoutMs));
      return yield* Option.match(completed, {
        onNone: () => Effect.fail(controlError("timeout", "App-control request timed out.")),
        onSome: Effect.succeed,
      });
    }).pipe(Effect.ensuring(removePending));
    return result as A;
  });

  return AppControlBroker.of({
    connect,
    focusHost,
    respond,
    cancelProviderSession,
    cancelThread,
    cancelAll,
    invoke,
  });
}).pipe(Effect.withSpan("AppControlBroker.make"));

let activeAppControlBroker: AppControlBroker["Service"] | undefined;

const live = Effect.acquireRelease(
  make.pipe(
    Effect.tap((broker) =>
      Effect.sync(() => {
        activeAppControlBroker = broker;
      }),
    ),
  ),
  (broker) =>
    Effect.sync(() => {
      if (activeAppControlBroker === broker) activeAppControlBroker = undefined;
    }),
);

export const layer = Layer.effect(AppControlBroker, live);

export const cancelActiveAppControlProviderSession = (providerSessionId: string) =>
  activeAppControlBroker?.cancelProviderSession(providerSessionId) ?? Effect.void;

export const cancelActiveAppControlThread = (threadId: string) =>
  activeAppControlBroker?.cancelThread(threadId) ?? Effect.void;

export const cancelAllActiveAppControlRequests = () =>
  activeAppControlBroker?.cancelAll ?? Effect.void;
