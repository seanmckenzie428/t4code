import type { CreateThreadInput, StartThreadTurnInput } from "@t3tools/client-runtime/operations";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type DesktopAppStartThreadRequest,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { startDesktopThread } from "./desktopThreadStart";
import { resolveThreadRouteRenderState } from "./threadRoutes";

const project = { environmentId: EnvironmentId.make("local"), projectId: ProjectId.make("lotus") };
const request: DesktopAppStartThreadRequest = {
  version: 1,
  type: "start-thread",
  requestId: "launch-1",
  platform: "darwin",
  workspaceRoot: "/repos/lotus",
  worktreePath: "/repos/deliverylabel",
  branch: "LOTUS-264-deliverylabel",
  title: "LOTUS-264 Rename delivery button",
  prompt: "Use $grill-me\nIssue text: `$(anything)`",
};
const defaults = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "project-default",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "full-access" as const,
};

describe("external planning thread", () => {
  it("persists and sends once with exact checkout, defaults, and real Plan mode", async () => {
    const order: string[] = [];
    const navigate = vi.fn(async () => undefined);
    const created: CreateThreadInput[] = [];
    const started: StartThreadTurnInput[] = [];
    const result = await startDesktopThread(project, request, defaults, {
      navigate,
      waitForThread: async () => undefined,
      create: async (input) => {
        created.push(input);
        order.push("create");
      },
      start: async (input) => {
        started.push(input);
        order.push("accepted");
      },
    });
    expect(order).toEqual(["create", "accepted"]);
    expect(navigate).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      projectId: "lotus",
      title: request.title,
      worktreePath: request.worktreePath,
      branch: request.branch,
      interactionMode: "plan",
      ...defaults,
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      interactionMode: "plan",
      message: { text: request.prompt },
      ...defaults,
    });
    expect(started[0]).not.toHaveProperty("bootstrap");
    expect(started[0]).not.toHaveProperty("titleSeed");
    expect(result).toEqual({ threadId: "launch-1", messageId: "launch-1:message" });
  });

  it("returns thread IDs only after the background turn is durably accepted", async () => {
    let accept!: () => void;
    let dispatch!: () => void;
    const accepted = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const dispatched = new Promise<void>((resolve) => {
      dispatch = resolve;
    });
    let completed = false;
    const result = startDesktopThread(project, request, defaults, {
      navigate: async () => undefined,
      waitForThread: async () => undefined,
      create: async () => undefined,
      start: async () => {
        dispatch();
        await accepted;
      },
    }).then((value) => {
      completed = true;
      return value;
    });
    await dispatched;
    expect(completed).toBe(false);
    accept();
    await expect(result).resolves.toEqual({ threadId: "launch-1", messageId: "launch-1:message" });
  });

  it("accepts an empty thread only after durable creation, without sending", async () => {
    const { prompt: _prompt, ...empty } = request;
    let accept!: () => void;
    let dispatched!: () => void;
    const accepted = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const dispatch = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const navigate = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    let completed = false;
    const result = startDesktopThread(project, empty, defaults, {
      navigate,
      waitForThread: async () => undefined,
      create: async (input) => {
        expect(input).toMatchObject({
          worktreePath: empty.worktreePath,
          branch: empty.branch,
          interactionMode: "default",
          ...defaults,
        });
        dispatched();
        await accepted;
      },
      start,
    }).then((value) => {
      completed = true;
      return value;
    });
    await dispatch;
    expect(completed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    accept();
    await expect(result).resolves.toEqual({ threadId: "launch-1" });
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      environmentId: project.environmentId,
      threadId: "launch-1",
    });
  });

  it("waits for shell projection so the new route cannot redirect to a fresh draft", async () => {
    const { prompt: _prompt, ...empty } = request;
    let shellExists = false;
    let publish!: () => void;
    let waiting!: () => void;
    const projection = new Promise<void>((resolve) => {
      publish = resolve;
    });
    const subscribed = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    let destination = "current";
    const navigate = vi.fn(async () => {
      const state = resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadExists: shellExists,
        serverThreadDeleted: false,
        draftThreadExists: false,
      });
      // ThreadRouteView redirects missing server threads to the new-draft route.
      destination = state === "missing" ? "/" : "/local/launch-1";
    });
    const dependencies = {
      create: async () => undefined,
      start: vi.fn(async () => undefined),
      waitForThread: async () => {
        waiting();
        await projection;
      },
      navigate,
    };
    const result = startDesktopThread(project, empty, defaults, dependencies);
    expect(
      await Promise.race([subscribed.then(() => "waiting"), result.then(() => destination)]),
    ).toBe("waiting");
    expect(navigate).not.toHaveBeenCalled();
    shellExists = true;
    publish();
    await result;
    expect(destination).toBe("/local/launch-1");
    expect(navigate).toHaveBeenCalledOnce();
    expect(dependencies.start).not.toHaveBeenCalled();
  });

  it("preserves the created thread when client visibility fails without navigating or resending", async () => {
    const { prompt: _prompt, ...empty } = request;
    const create = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    await expect(
      startDesktopThread(project, empty, defaults, {
        create,
        navigate,
        start,
        waitForThread: async () => {
          throw new Error("created thread is not visible yet");
        },
      }),
    ).rejects.toThrow("created thread is not visible yet");
    expect(create).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("never retries an uncertain empty-thread creation", async () => {
    const { prompt: _prompt, ...empty } = request;
    const create = vi.fn(async () => {
      throw new Error("ack lost");
    });
    const start = vi.fn(async () => undefined);
    await expect(
      startDesktopThread(project, empty, defaults, {
        waitForThread: async () => undefined,
        create,
        start,
        navigate: async () => undefined,
      }),
    ).rejects.toThrow("ack lost");
    expect(create).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it("never retries an uncertain start or removes the created thread", async () => {
    const create = vi.fn(async () => undefined);
    const start = vi.fn(async () => {
      throw new Error("ack lost");
    });
    await expect(
      startDesktopThread(project, request, defaults, {
        waitForThread: async () => undefined,
        create,
        start,
        navigate: async () => undefined,
      }),
    ).rejects.toThrow("ack lost");
    expect(create).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("uses different thread identities for separate launches", async () => {
    const deps = {
      navigate: async () => undefined,
      waitForThread: async () => undefined,
      create: async () => undefined,
      start: async () => undefined,
    };
    const first = await startDesktopThread(project, request, defaults, deps);
    const second = await startDesktopThread(
      project,
      { ...request, requestId: "launch-2" },
      defaults,
      deps,
    );
    expect(first.threadId).not.toEqual(second.threadId);
  });
});
