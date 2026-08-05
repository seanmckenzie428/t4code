import {
  type AppControlError,
  type AppControlHost,
  type AppControlRequest,
  type AppControlResponse,
  type AppControlStreamEvent,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

type AppControlStreamResult<E> = AsyncResult.AsyncResult<AppControlStreamEvent, E>;

const errorCodes = new Set<AppControlError["code"]>([
  "unavailable",
  "disconnected",
  "timeout",
  "malformed-response",
  "unsupported",
  "forbidden",
  "conflict",
  "invalid-input",
  "execution-failed",
]);

export function serializeAppControlHostError(cause: unknown): AppControlError {
  if (typeof cause === "object" && cause !== null) {
    const code = "code" in cause ? cause.code : undefined;
    const message = "message" in cause ? cause.message : undefined;
    if (typeof code === "string" && errorCodes.has(code as AppControlError["code"])) {
      return {
        code: code as AppControlError["code"],
        message: typeof message === "string" && message.trim() ? message : "Client command failed.",
        retryable: code === "disconnected" || code === "timeout",
      };
    }
  }
  return {
    code: "execution-failed",
    message:
      cause instanceof Error && cause.message.trim() ? cause.message : "Client command failed.",
    retryable: false,
  };
}

/**
 * Consumes every stream event directly from the atom registry. React renders
 * are not a delivery mechanism: two requests may arrive between renders, and a
 * reconnect may leave a late event from the replaced stream in flight.
 */
export function createAppControlRequestConsumerAtom<E>(options: {
  readonly requestsAtom: Atom.Atom<AppControlStreamResult<E>>;
  readonly clientId: AppControlHost["clientId"];
  readonly connectionAtom: Atom.Writable<AppControlStreamEvent["connectionId"] | null>;
  readonly requestHandlerAtom: Atom.Atom<{
    readonly handle: (request: AppControlRequest) => Promise<unknown>;
  }>;
  readonly respond: (response: AppControlResponse) => Promise<unknown>;
  readonly label: string;
}): Atom.Atom<void> {
  return Atom.make((get) => {
    get.mount(options.connectionAtom);
    get.mount(options.requestHandlerAtom);
    let disposed = false;
    let activeConnectionId: AppControlStreamEvent["connectionId"] | null = null;
    let connectionExplicitlyAnnounced = false;
    let reportedConnectionId: AppControlStreamEvent["connectionId"] | null = null;
    let requestsVersion = 0;

    const consume = (result: AppControlStreamResult<E>) => {
      if (!AsyncResult.isSuccess(result)) return;
      const event = result.value;
      if (event.type === "connected") {
        activeConnectionId = event.connectionId;
        connectionExplicitlyAnnounced = true;
      } else if (activeConnectionId === null) {
        activeConnectionId = event.connectionId;
      } else if (activeConnectionId !== event.connectionId) {
        if (connectionExplicitlyAnnounced) return;
        activeConnectionId = event.connectionId;
      }
      if (reportedConnectionId !== event.connectionId) {
        reportedConnectionId = event.connectionId;
        get.set(options.connectionAtom, event.connectionId);
      }
      if (event.type === "connected") return;
      const request = event.request;
      void get
        .once(options.requestHandlerAtom)
        .handle(request)
        .then(
          (result) =>
            options.respond({
              clientId: options.clientId,
              connectionId: event.connectionId,
              requestId: request.requestId,
              ok: true,
              ...(result === undefined ? {} : { result }),
            }),
          (cause) =>
            options.respond({
              clientId: options.clientId,
              connectionId: event.connectionId,
              requestId: request.requestId,
              ok: false,
              error: serializeAppControlHostError(cause),
            }),
        );
    };

    get.addFinalizer(() => {
      disposed = true;
    });
    const initialRequest = get.once(options.requestsAtom);
    if (AsyncResult.isSuccess(initialRequest)) {
      activeConnectionId = initialRequest.value.connectionId;
      connectionExplicitlyAnnounced = initialRequest.value.type === "connected";
      if (initialRequest.value.type === "connected") {
        reportedConnectionId = initialRequest.value.connectionId;
        get.set(options.connectionAtom, initialRequest.value.connectionId);
      }
    }
    get.subscribe(options.requestsAtom, (result) => {
      requestsVersion += 1;
      consume(result);
    });
    queueMicrotask(() => {
      const initialConnectionWasSkipped =
        AsyncResult.isSuccess(initialRequest) &&
        initialRequest.value.connectionId === activeConnectionId &&
        initialRequest.value.connectionId !== reportedConnectionId;
      if (!disposed && (requestsVersion === 0 || initialConnectionWasSkipped)) {
        consume(initialRequest);
      }
    });
  }).pipe(Atom.setIdleTTL(0), Atom.withLabel(options.label));
}
