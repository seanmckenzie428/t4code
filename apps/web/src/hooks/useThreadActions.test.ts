import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  invokeThreadLifecycle,
  navigateAfterThreadDeletion,
  requestThreadUnpinConfirmation,
  ThreadArchiveBlockedError,
} from "./useThreadActions";
import { toastManager } from "../components/ui/toast";
import { registerWebAppCommandHandler, webAppCommandRegistry } from "../appCommandRegistry";

describe("thread lifecycle command routing", () => {
  const target = {
    environmentId: EnvironmentId.make("environment-routing"),
    threadId: ThreadId.make("thread-routing"),
  };
  const until = "2030-01-01T00:00:00.000Z";

  afterEach(() => vi.restoreAllMocks());

  it.each([
    {
      command: "thread.settle",
      args: { threadId: target.threadId },
      options: { undoToast: false },
    },
    {
      command: "thread.snooze",
      args: { threadId: target.threadId, until },
      options: { undoToast: false },
    },
    { command: "thread.unsettle", args: { threadId: target.threadId }, options: {} },
    { command: "thread.unsnooze", args: { threadId: target.threadId }, options: {} },
    {
      command: "thread.unarchive",
      args: { threadId: target.threadId },
      options: { navigate: true },
    },
  ] as const)(
    "routes $command batch/Undo options through the registry without changing command arguments",
    async ({ command, args, options }) => {
      const invoke = vi.spyOn(webAppCommandRegistry, "invoke");
      const execute = vi.fn(() => "completed");
      const dispose = registerWebAppCommandHandler(command, execute);
      try {
        await expect(invokeThreadLifecycle(command, target, args, options)).resolves.toBe(
          "completed",
        );
        expect(invoke).toHaveBeenCalledOnce();
        expect(execute).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ commandId: command, args }),
          {
            environmentId: target.environmentId,
            threadId: target.threadId,
            source: "button",
            threadLifecycleOptions: options,
          },
        );
        expect(invoke.mock.calls[0]?.[0].args).toEqual(args);
      } finally {
        dispose();
      }
    },
  );

  it("keeps batch actions subject to command availability", async () => {
    const execute = vi.fn();
    const dispose = registerWebAppCommandHandler("thread.settle", execute, () => ({
      available: false,
      reason: "Environment unavailable",
    }));
    try {
      await expect(
        invokeThreadLifecycle(
          "thread.settle",
          target,
          { threadId: target.threadId },
          { undoToast: false },
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("validates batch arguments before dispatch", async () => {
    const execute = vi.fn();
    const dispose = registerWebAppCommandHandler("thread.snooze", execute);
    try {
      await expect(
        invokeThreadLifecycle("thread.snooze", target, { until }, { undoToast: false }),
      ).rejects.toMatchObject({ code: "invalid-arguments" });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("keeps failed Undo commands observable", async () => {
    const dispose = registerWebAppCommandHandler("thread.unsettle", () => {
      throw new Error("Environment disconnected");
    });
    try {
      await expect(
        invokeThreadLifecycle("thread.unsettle", target, { threadId: target.threadId }),
      ).rejects.toThrow("Environment disconnected");
    } finally {
      dispose();
    }
  });
});

describe("navigateAfterThreadDeletion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports a rejected navigation without failing the completed deletion", async () => {
    const addToast = vi.spyOn(toastManager, "add").mockReturnValue("navigation-error");

    await expect(
      navigateAfterThreadDeletion(() => Promise.reject(new Error("route unavailable"))),
    ).resolves.toBeUndefined();

    expect(addToast).toHaveBeenCalledOnce();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Thread deleted, but navigation failed",
        description: "route unavailable",
      }),
    );
  });

  it("does not report an error after successful navigation", async () => {
    const addToast = vi.spyOn(toastManager, "add");

    await navigateAfterThreadDeletion(() => Promise.resolve());

    expect(addToast).not.toHaveBeenCalled();
  });
});

describe("ThreadArchiveBlockedError", () => {
  it("keeps the blocked thread context with the fixed message", () => {
    const error = new ThreadArchiveBlockedError({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });

    expect(error).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
    });
    expect(error.message).toBe("Cannot archive a running thread.");
  });
});

describe("requestThreadUnpinConfirmation", () => {
  it("skips the dialog when confirmation is disabled", async () => {
    let callCount = 0;
    const result = await requestThreadUnpinConfirmation({
      enabled: false,
      title: "Pinned thread",
      confirm: async () => {
        callCount += 1;
        return false;
      },
    });

    expect(result).toMatchObject({ _tag: "Success", value: true });
    expect(callCount).toBe(0);
  });

  it("degrades gracefully when dialogs are unavailable", async () => {
    const result = await requestThreadUnpinConfirmation({
      enabled: true,
      title: "Pinned thread",
      confirm: null,
    });

    expect(result).toMatchObject({ _tag: "Success", value: true });
  });

  it("uses the thread title and returns the user's decision", async () => {
    let message = "";
    const result = await requestThreadUnpinConfirmation({
      enabled: true,
      title: "Release prep",
      confirm: async (nextMessage) => {
        message = nextMessage;
        return false;
      },
    });

    expect(message).toBe(
      'Unpin thread "Release prep"?\nThis will move the thread out of your pinned section.',
    );
    expect(result).toMatchObject({ _tag: "Success", value: false });
  });

  it("keeps dialog failures observable", async () => {
    const result = await requestThreadUnpinConfirmation({
      enabled: true,
      title: "Pinned thread",
      confirm: () => Promise.reject(new Error("dialog unavailable")),
    });

    expect(result._tag).toBe("Failure");
  });
});
