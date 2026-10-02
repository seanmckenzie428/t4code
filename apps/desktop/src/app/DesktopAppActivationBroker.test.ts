import { ProjectId, ThreadId, type DesktopAppActivationRequest } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DesktopAppActivationBroker } from "./DesktopAppActivationBroker.ts";

const request: DesktopAppActivationRequest = {
  version: 1,
  requestId: "request-1",
  type: "open-workspace",
  workspaceRoot: "/workspace/project",
  platform: "linux",
};

describe("DesktopAppActivationBroker", () => {
  it("focuses immediately and waits for renderer readiness", async () => {
    const activate = vi.fn();
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate });

    const response = broker.request(request);
    expect(activate).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();

    broker.registerRenderer(send);
    expect(send).toHaveBeenCalledWith(request);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(response).resolves.toMatchObject({ ok: true, projectId: "project-1" });
    broker.close();
  });

  it.each([true, false])(
    "starts a background thread without focusing (renderer ready: %s)",
    async (ready) => {
      const activate = vi.fn();
      const send = vi.fn();
      const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate });
      const backgroundRequest: DesktopAppActivationRequest = {
        ...request,
        type: "start-thread",
        worktreePath: "/workspace/issue",
        branch: "LOTUS-264-deliverylabel",
        title: "Delivery label",
        prompt: "Use $grill-me",
      };
      if (ready) broker.registerRenderer(send);
      const response = broker.request(backgroundRequest);
      if (!ready) broker.registerRenderer(send);
      expect(send).toHaveBeenCalledExactlyOnceWith(backgroundRequest);
      broker.complete({
        version: 1,
        requestId: request.requestId,
        ok: true,
        accepted: true,
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
      });
      await expect(response).resolves.toMatchObject({ ok: true, accepted: true });
      expect(activate).not.toHaveBeenCalled();
      broker.close();
    },
  );

  it.each([true, false])(
    "focuses an empty thread only after successful completion (%s)",
    async (success) => {
      const activate = vi.fn();
      const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1000, activate });
      broker.registerRenderer(vi.fn());
      const response = broker.request({
        ...request,
        type: "start-thread",
        worktreePath: "/workspace/task",
        branch: "task",
        title: "task",
      });
      expect(activate).not.toHaveBeenCalled();
      if (success) {
        broker.complete({
          version: 1,
          requestId: request.requestId,
          ok: true,
          accepted: true,
          projectId: ProjectId.make("project-1"),
          threadId: ThreadId.make("thread-1"),
        });
      } else {
        broker.complete({
          version: 1,
          requestId: request.requestId,
          ok: false,
          code: "thread-start-failed",
          message: "failed",
        });
      }
      await response;
      expect(activate).toHaveBeenCalledTimes(success ? 1 : 0);
      broker.close();
    },
  );

  it("fails an in-flight request when the renderer goes away", async () => {
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(vi.fn());

    const response = broker.request(request);
    broker.clearRenderer();

    await expect(response).resolves.toMatchObject({
      ok: false,
      code: "renderer-unavailable",
    });
    broker.close();
  });

  it("queues requests after unsubscribe until a new renderer registers", async () => {
    const previousSend = vi.fn();
    const nextSend = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(previousSend);
    broker.clearRenderer();

    const response = broker.request(request);
    expect(previousSend).not.toHaveBeenCalled();
    expect(nextSend).not.toHaveBeenCalled();

    broker.registerRenderer(nextSend);
    expect(nextSend).toHaveBeenCalledWith(request);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(response).resolves.toMatchObject({ ok: true });
    broker.close();
  });

  it("removes a queued request when its CLI connection closes", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });

    const response = broker.request(request);
    broker.cancel(request.requestId);
    broker.registerRenderer(send);

    await expect(response).resolves.toMatchObject({ ok: false, code: "renderer-unavailable" });
    expect(send).not.toHaveBeenCalled();
    broker.close();
  });

  it("never sends a canceled request that was queued behind another request", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
    broker.registerRenderer(send);
    const secondRequest = { ...request, requestId: "request-2" };

    const firstResponse = broker.request(request);
    const secondResponse = broker.request(secondRequest);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(request);

    broker.cancel(secondRequest.requestId);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(firstResponse).resolves.toMatchObject({ ok: true });
    await expect(secondResponse).resolves.toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(1);
    broker.close();
  });

  it("times out a request without polling", async () => {
    vi.useFakeTimers();
    try {
      const broker = new DesktopAppActivationBroker({ requestTimeoutMs: 1_000, activate: vi.fn() });
      const response = broker.request(request);

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(response).resolves.toMatchObject({ ok: false, code: "request-timeout" });
      broker.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
