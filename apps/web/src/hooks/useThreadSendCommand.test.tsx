import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { invokeWebAppCommand } from "../appCommandRegistry";
import {
  isQueuedMessageDue,
  useQueuedMessages,
  useQueuedMessageStore,
  type QueuedComposerMessage,
} from "../queuedMessageStore";
import { useThreadSendCommand } from "./useThreadSendCommand";

const thread = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const threadKey = scopedThreadKey(thread);
const context = { ...thread, source: "button" as const };
let root: Root;
let sent: QueuedComposerMessage[];
let failures: unknown[];

function ChatProbe(props: {
  thread: ScopedThreadRef;
  phase: "running" | "ready";
  toolActivityId: string | null;
}) {
  const queue = useQueuedMessages(scopedThreadKey(props.thread));
  const next = queue[0];

  // ChatView's queue effect precedes its command host. A provider update
  // changes both the dispatch boundary and the host's render snapshot.
  useEffect(() => {
    if (
      !next ||
      !isQueuedMessageDue({
        message: next,
        phase: props.phase,
        latestToolActivityId: props.toolActivityId,
      })
    ) {
      return;
    }
    void invokeWebAppCommand(
      "thread.send",
      { ...props.thread, source: "button" },
      {
        threadId: props.thread.threadId,
        text: next.prompt,
        submissionIntent: next.submissionIntent,
        queuedMessageId: next.id,
      },
    ).catch((error: unknown) => failures.push(error));
  }, [next, props.phase, props.toolActivityId, props.thread]);

  useThreadSendCommand({
    thread: props.thread,
    readPrompt: () => "unsent composer draft",
    send: async (_intent, message) => {
      if (!message) throw new Error("Expected the queued snapshot, not the composer draft.");
      const taken = useQueuedMessageStore
        .getState()
        .take(scopedThreadKey(props.thread), message.id, props.toolActivityId);
      if (taken) sent.push(taken);
    },
  });
  return null;
}

beforeEach(() => {
  const document = {
    nodeType: 9,
    addEventListener() {},
    removeEventListener() {},
  };
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
  sent = [];
  failures = [];
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGeneration: 0 });
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("thread send command lifecycle", () => {
  it.each([
    { boundary: "turn completion", phase: "ready" as const, toolActivityId: null },
    { boundary: "tool completion", phase: "running" as const, toolActivityId: "tool-1" },
  ])("sends a queued message once on $boundary while the host updates", async (update) => {
    const queued = useQueuedMessageStore.getState().enqueue(threadKey, {
      prompt: "queued follow-up",
      images: [],
      files: [],
      terminalContexts: [],
      previewAnnotations: [],
      reviewComments: [],
      submissionIntent: "foreground",
      queuedAfterToolActivityId: null,
      createdAt: "2026-09-22T00:00:00.000Z",
    });
    await act(() =>
      root.render(
        <StrictMode>
          <ChatProbe thread={thread} phase="running" toolActivityId={null} />
        </StrictMode>,
      ),
    );
    expect(sent).toEqual([]);

    await act(() =>
      root.render(
        <StrictMode>
          <ChatProbe thread={{ ...thread }} {...update} />
        </StrictMode>,
      ),
    );

    expect(failures).toEqual([]);
    expect(sent).toEqual([queued]);
    expect(useQueuedMessageStore.getState().queuesByThreadKey[threadKey]).toBeUndefined();
  });

  it("removes the old thread host on navigation and the current host on unmount", async () => {
    await act(() =>
      root.render(<ChatProbe thread={thread} phase="running" toolActivityId={null} />),
    );
    const otherThread = scopeThreadRef(thread.environmentId, ThreadId.make("thread-2"));
    await act(() =>
      root.render(<ChatProbe thread={otherThread} phase="running" toolActivityId={null} />),
    );
    await expect(
      invokeWebAppCommand("thread.send", context, {
        threadId: thread.threadId,
        text: "unsent composer draft",
      }),
    ).rejects.toThrow("not hosted");

    await act(() => root.render(null));
    await expect(
      invokeWebAppCommand(
        "thread.send",
        { ...otherThread, source: "button" },
        {
          threadId: otherThread.threadId,
          text: "unsent composer draft",
        },
      ),
    ).rejects.toThrow("not hosted");
  });
});
