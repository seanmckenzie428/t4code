import { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  handleDesktopAppActivationRequest,
  type DesktopAppActivationDependencies,
} from "./desktopAppActivation";

const environmentId = EnvironmentId.make("primary");
const existingProjectId = ProjectId.make("project-existing");
const createdProjectId = ProjectId.make("project-created");
const threadId = ThreadId.make("thread-1");
const request = {
  version: 1,
  requestId: "request-1",
  type: "open-workspace",
  workspaceRoot: "/workspace/project",
  platform: "linux",
} as const;

function dependencies(
  overrides: Partial<DesktopAppActivationDependencies> = {},
): DesktopAppActivationDependencies {
  return {
    getTarget: () => ({ environmentId, platform: "linux" }),
    findProject: () => ({
      id: existingProjectId,
      environmentId,
      workspaceRoot: request.workspaceRoot,
    }),
    createProject: vi.fn(async () => createdProjectId),
    waitForProject: vi.fn(async () => undefined),
    openThread: vi.fn(async () => ({ threadId })),
    startThread: vi.fn(async () => ({ threadId, messageId: MessageId.make("message-1") })),
    ...overrides,
  };
}

describe("desktop app activation", () => {
  it("starts a thread under the existing project without opening a draft", async () => {
    const deps = dependencies();
    const response = await handleDesktopAppActivationRequest(
      {
        ...request,
        type: "start-thread",
        worktreePath: "/workspace/issue",
        branch: "LOTUS-264-deliverylabel",
        title: "LOTUS-264 Delivery label",
        prompt: "Use $grill-me",
      },
      deps,
    );
    expect(response).toMatchObject({
      ok: true,
      accepted: true,
      projectId: existingProjectId,
      threadId,
      messageId: "message-1",
    });
    expect(deps.openThread).not.toHaveBeenCalled();
    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.startThread).toHaveBeenCalledOnce();
  });

  it("returns accepted empty-thread creation without a message ID", async () => {
    const deps = dependencies({ startThread: vi.fn(async () => ({ threadId })) });
    const response = await handleDesktopAppActivationRequest(
      {
        ...request,
        type: "start-thread",
        worktreePath: "/workspace/task",
        branch: "task",
        title: "task",
      },
      deps,
    );
    expect(response).toMatchObject({ ok: true, accepted: true, threadId });
    expect(response).not.toHaveProperty("messageId");
    expect(deps.openThread).not.toHaveBeenCalled();
  });

  it("requires an existing project for external thread starts", async () => {
    const deps = dependencies({ findProject: () => null });
    const response = await handleDesktopAppActivationRequest(
      {
        ...request,
        type: "start-thread",
        worktreePath: "/workspace/issue",
        branch: "LOTUS-264-deliverylabel",
        title: "Title",
        prompt: "Prompt",
      },
      deps,
    );
    expect(response).toMatchObject({ ok: false, code: "project-not-found" });
    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.startThread).not.toHaveBeenCalled();
  });
  it("reuses an existing project and opens a new thread", async () => {
    const deps = dependencies();

    const response = await handleDesktopAppActivationRequest(request, deps);

    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.openThread).toHaveBeenCalledWith({ environmentId, projectId: existingProjectId });
    expect(response).toEqual({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: existingProjectId,
      threadId,
    });
  });

  it("waits for a created project before it opens the thread", async () => {
    const order: string[] = [];
    const deps = dependencies({
      findProject: () => null,
      createProject: vi.fn(async () => {
        order.push("create");
        return createdProjectId;
      }),
      waitForProject: vi.fn(async () => {
        order.push("project-event");
      }),
      openThread: vi.fn(async () => {
        order.push("open-thread");
        return { threadId };
      }),
    });

    const response = await handleDesktopAppActivationRequest(request, deps);

    expect(order).toEqual(["create", "project-event", "open-thread"]);
    expect(response).toMatchObject({ ok: true, projectId: createdProjectId });
  });

  it("rejects a Windows path when the primary environment is WSL", async () => {
    const response = await handleDesktopAppActivationRequest(
      { ...request, platform: "win32" },
      dependencies({ getTarget: () => ({ environmentId, platform: "linux" }) }),
    );

    expect(response).toMatchObject({ ok: false, code: "platform-mismatch" });
  });

  it("returns a project error without opening a thread", async () => {
    const openThread = vi.fn(async () => ({ threadId }));
    const response = await handleDesktopAppActivationRequest(
      request,
      dependencies({
        findProject: () => null,
        createProject: vi.fn(async () => {
          throw new Error("Project path is not available.");
        }),
        openThread,
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      code: "project-create-failed",
      message: "Project path is not available.",
    });
    expect(openThread).not.toHaveBeenCalled();
  });
});
