import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeWebAppCommand } from "../appCommandRegistry";
import type { ComposerSubmissionIntent } from "../composer-logic";
import { useThreadSendCommand } from "./useThreadSendCommand";

const thread = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const context = { ...thread, source: "button" as const };
let root: Root;
const send =
  vi.fn<(mode: ComposerDispatchMode, intent: ComposerSubmissionIntent) => Promise<void>>();
function ChatProbe(props: { thread: ScopedThreadRef; prompt?: string }) {
  useThreadSendCommand({ thread: props.thread, readPrompt: () => props.prompt ?? "draft", send });
  return null;
}
beforeEach(() => {
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(container as unknown as HTMLElement);
  send.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("thread send command lifecycle", () => {
  it.each(["auto", "queue", "steer", "restart", "start"] as const)(
    "dispatches %s once through the active host after it updates",
    async (dispatchMode) => {
      await act(() =>
        root.render(
          <StrictMode>
            <ChatProbe thread={thread} />
          </StrictMode>,
        ),
      );
      await act(() =>
        root.render(
          <StrictMode>
            <ChatProbe thread={{ ...thread }} prompt="updated" />
          </StrictMode>,
        ),
      );
      await invokeWebAppCommand("thread.send", context, {
        threadId: thread.threadId,
        text: "updated",
        dispatchMode,
        submissionIntent: "background",
      });
      expect(send).toHaveBeenCalledExactlyOnceWith(dispatchMode, "background");
    },
  );
  it("rejects a stale composer snapshot without enqueueing it", async () => {
    await act(() => root.render(<ChatProbe thread={thread} prompt="new text" />));
    await expect(
      invokeWebAppCommand("thread.send", context, {
        threadId: thread.threadId,
        text: "old text",
        dispatchMode: "queue",
      }),
    ).rejects.toThrow("composer changed");
    expect(send).not.toHaveBeenCalled();
  });
  it("defaults to automatic foreground dispatch", async () => {
    await act(() => root.render(<ChatProbe thread={thread} />));
    await invokeWebAppCommand("thread.send", context, { threadId: thread.threadId, text: "draft" });
    expect(send).toHaveBeenCalledExactlyOnceWith("auto", "foreground");
  });
  it("removes the old thread host on navigation and the current host on unmount", async () => {
    await act(() => root.render(<ChatProbe thread={thread} />));
    const otherThread = scopeThreadRef(thread.environmentId, ThreadId.make("thread-2"));
    await act(() => root.render(<ChatProbe thread={otherThread} />));
    await expect(
      invokeWebAppCommand("thread.send", context, { threadId: thread.threadId, text: "draft" }),
    ).rejects.toThrow("not hosted");
    await act(() => root.render(null));
    await expect(
      invokeWebAppCommand(
        "thread.send",
        { ...otherThread, source: "button" },
        { threadId: otherThread.threadId, text: "draft" },
      ),
    ).rejects.toThrow("not hosted");
  });
});
