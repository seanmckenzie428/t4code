import {
  AppActionId,
  AppCommandId,
  AppControlClientId,
  AppControlConnectionId,
  ProjectId,
  ThreadId,
  type AppControlRequest,
  type AppControlResponse,
  type AppControlStreamEvent,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAppControlRequestConsumerAtom,
  serializeAppControlHostError,
} from "./appControlRequestConsumer";

const clientId = AppControlClientId.make("client-1");
const connectionId = AppControlConnectionId.make("connection-1");
const request = (requestId: string): AppControlRequest => ({
  requestId,
  actionId: AppActionId.make(`action:${requestId}`),
  principal: {
    kind: "thread-agent",
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
  },
  commandId: AppCommandId.make("ui.diff.open"),
  args: {},
  timeoutMs: 15_000,
});
const requestEvent = (
  requestId: string,
  eventConnectionId = connectionId,
): AppControlStreamEvent => ({
  type: "request",
  connectionId: eventConnectionId,
  request: request(requestId),
});

const consumerState = (handle: (request: AppControlRequest) => Promise<unknown>) => ({
  connectionAtom: Atom.make<AppControlConnectionId | null>(null),
  requestHandlerAtom: Atom.make({ handle }),
});

describe("appControlRequestConsumer", () => {
  it("consumes every request emitted between React renders", async () => {
    const requestsAtom = Atom.make<AsyncResult.AsyncResult<AppControlStreamEvent, Error>>(
      AsyncResult.initial<AppControlStreamEvent, Error>(false),
    );
    const handle = vi.fn(async (value: AppControlRequest) => value.requestId);
    const responses: AppControlResponse[] = [];
    const respond = vi.fn(async (response: AppControlResponse) => {
      responses.push(response);
    });
    const state = consumerState(handle);
    const consumer = createAppControlRequestConsumerAtom({
      requestsAtom,
      clientId,
      connectionAtom: state.connectionAtom,
      requestHandlerAtom: state.requestHandlerAtom,
      respond,
      label: "test:app-control:all-events",
    });
    const registry = AtomRegistry.make();
    registry.mount(consumer);

    registry.set(requestsAtom, AsyncResult.success(requestEvent("request-1")));
    registry.set(requestsAtom, AsyncResult.success(requestEvent("request-2")));

    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(handle.mock.calls.map(([value]) => value.requestId)).toEqual(["request-1", "request-2"]);
    expect(responses.map(({ requestId }) => requestId)).toEqual(["request-1", "request-2"]);
    registry.dispose();
  });

  it("drops requests from a replaced connection generation", async () => {
    const nextConnectionId = AppControlConnectionId.make("connection-2");
    const requestsAtom = Atom.make(
      AsyncResult.success<AppControlStreamEvent, Error>({
        type: "connected",
        connectionId: nextConnectionId,
      }),
    );
    const handle = vi.fn(async () => undefined);
    const respond = vi.fn(async (_response: AppControlResponse) => undefined);
    const state = consumerState(handle);
    const consumer = createAppControlRequestConsumerAtom({
      requestsAtom,
      clientId,
      connectionAtom: state.connectionAtom,
      requestHandlerAtom: state.requestHandlerAtom,
      respond,
      label: "test:app-control:stale-generation",
    });
    const registry = AtomRegistry.make();
    registry.mount(consumer);
    registry.set(requestsAtom, AsyncResult.success(requestEvent("stale", connectionId)));

    await vi.waitFor(() => expect(registry.get(state.connectionAtom)).toBe(nextConnectionId));
    expect(handle).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("uses the latest handler without rebuilding the stream consumer", async () => {
    const requestsAtom = Atom.make<AsyncResult.AsyncResult<AppControlStreamEvent, Error>>(
      AsyncResult.initial<AppControlStreamEvent, Error>(false),
    );
    const first = vi.fn(async () => "first");
    const second = vi.fn(async () => "second");
    const respond = vi.fn(async (_response: AppControlResponse) => undefined);
    const state = consumerState(first);
    const consumer = createAppControlRequestConsumerAtom({
      requestsAtom,
      clientId,
      connectionAtom: state.connectionAtom,
      requestHandlerAtom: state.requestHandlerAtom,
      respond,
      label: "test:app-control:latest-handler",
    });
    const registry = AtomRegistry.make();
    registry.mount(consumer);
    registry.set(requestsAtom, AsyncResult.success(requestEvent("first")));
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    registry.set(state.requestHandlerAtom, { handle: second });
    registry.set(requestsAtom, AsyncResult.success(requestEvent("second")));

    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("sanitizes unknown host failures and preserves typed control errors", () => {
    expect(serializeAppControlHostError(new Error("renderer failed"))).toEqual({
      code: "execution-failed",
      message: "renderer failed",
      retryable: false,
    });
    expect(serializeAppControlHostError({ code: "timeout", message: "host timed out" })).toEqual({
      code: "timeout",
      message: "host timed out",
      retryable: true,
    });
  });
});
