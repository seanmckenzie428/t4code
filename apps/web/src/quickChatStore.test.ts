import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectQuickChat, useQuickChatStore } from "./quickChatStore";

const environmentA = "environment-a" as EnvironmentId;

beforeEach(() => {
  useQuickChatStore.setState({ byEnvironment: {} });
});

describe("quickChatStore", () => {
  it("creates one transient thread and preserves it while hidden", () => {
    useQuickChatStore.getState().open(environmentA);
    const first = selectQuickChat(useQuickChatStore.getState(), environmentA);
    useQuickChatStore.getState().close(environmentA);
    useQuickChatStore.getState().open(environmentA);
    const reopened = selectQuickChat(useQuickChatStore.getState(), environmentA);

    expect(first?.open).toBe(true);
    expect(reopened?.threadId).toBe(first?.threadId);
  });

  it("allocates a different thread for New Chat", () => {
    useQuickChatStore.getState().open(environmentA);
    const first = selectQuickChat(useQuickChatStore.getState(), environmentA);
    useQuickChatStore.getState().newChat(environmentA);
    const next = selectQuickChat(useQuickChatStore.getState(), environmentA);

    expect(next?.open).toBe(true);
    expect(next?.threadId).not.toBe(first?.threadId);
  });

  it("opens saved threads and rotates a deleted active id", () => {
    const savedThreadId = ThreadId.make("saved-quick-chat");
    useQuickChatStore.getState().openThread(environmentA, savedThreadId);
    expect(selectQuickChat(useQuickChatStore.getState(), environmentA)).toMatchObject({
      open: true,
      threadId: savedThreadId,
    });

    useQuickChatStore.getState().forgetThread(environmentA, savedThreadId);
    const forgotten = selectQuickChat(useQuickChatStore.getState(), environmentA);
    expect(forgotten?.open).toBe(false);
    expect(forgotten?.threadId).not.toBe(savedThreadId);
  });

  it("rotates the active id after a chat is saved on close", () => {
    useQuickChatStore.getState().open(environmentA);
    const active = selectQuickChat(useQuickChatStore.getState(), environmentA);
    if (!active) throw new Error("Expected an active Quick Chat");

    useQuickChatStore.getState().finishChat(environmentA, active.threadId);
    const finished = selectQuickChat(useQuickChatStore.getState(), environmentA);
    expect(finished?.open).toBe(false);
    expect(finished?.threadId).not.toBe(active.threadId);
  });
});
