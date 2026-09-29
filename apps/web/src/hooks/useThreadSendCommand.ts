import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useLayoutEffect } from "react";

import { registerWebAppCommandHandler } from "../appCommandRegistry";
import type { ComposerSubmissionIntent } from "../composer-logic";
import { useQueuedMessageStore, type QueuedComposerMessage } from "../queuedMessageStore";

export function useThreadSendCommand(input: {
  thread: ScopedThreadRef | null;
  readPrompt: () => string;
  send: (
    submissionIntent: ComposerSubmissionIntent,
    queuedMessage?: QueuedComposerMessage,
  ) => Promise<void>;
}) {
  const { thread, readPrompt, send } = input;
  // Queue dispatch runs in a passive effect. Keep its command host available
  // before those effects run, including when a provider update replaces it.
  useLayoutEffect(() => {
    if (!thread) return;
    return registerWebAppCommandHandler(
      "thread.send",
      (invocation) => {
        const { threadId, text, submissionIntent, queuedMessageId } = invocation.args as {
          threadId: string;
          text: string;
          submissionIntent?: ComposerSubmissionIntent;
          queuedMessageId?: string;
        };
        if (threadId !== thread.threadId) {
          throw new Error(`Thread ${String(threadId)} is not the active thread.`);
        }
        const queuedMessage =
          queuedMessageId === undefined
            ? undefined
            : useQueuedMessageStore
                .getState()
                .queuesByThreadKey[scopedThreadKey(thread)]?.find(
                  (entry) => entry.id === queuedMessageId,
                );
        if (queuedMessageId !== undefined && !queuedMessage) {
          throw new Error("The queued message is no longer available.");
        }
        if (text !== (queuedMessage?.prompt ?? readPrompt())) {
          throw new Error("The composer changed before the send command executed.");
        }
        return send(submissionIntent ?? "foreground", queuedMessage);
      },
      (context) => ({
        available:
          context.queuedMessageDispatch !== true &&
          context.environmentId === thread.environmentId &&
          (context.threadId === undefined || context.threadId === thread.threadId),
        reason: "The command is hosted by another active thread.",
      }),
    );
  }, [thread, readPrompt, send]);
}
