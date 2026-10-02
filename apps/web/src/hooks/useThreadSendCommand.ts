import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { useLayoutEffect } from "react";
import { registerWebAppCommandHandler } from "../appCommandRegistry";
import type { ComposerSubmissionIntent } from "../composer-logic";

export function useThreadSendCommand(input: {
  thread: ScopedThreadRef | null;
  readPrompt: () => string;
  send: (
    dispatchMode: ComposerDispatchMode,
    submissionIntent: ComposerSubmissionIntent,
  ) => Promise<void>;
}) {
  const { thread, readPrompt, send } = input;
  // Register before passive effects so command callers observe the current composer.
  useLayoutEffect(() => {
    if (!thread) return;
    return registerWebAppCommandHandler(
      "thread.send",
      (invocation) => {
        const { threadId, text, dispatchMode, submissionIntent } = invocation.args as {
          threadId: string;
          text: string;
          dispatchMode?: ComposerDispatchMode;
          submissionIntent?: ComposerSubmissionIntent;
        };
        if (threadId !== thread.threadId)
          throw new Error(`Thread ${String(threadId)} is not the active thread.`);
        if (text !== readPrompt())
          throw new Error("The composer changed before the send command executed.");
        return send(dispatchMode ?? "auto", submissionIntent ?? "foreground");
      },
      (context) => ({
        available:
          context.environmentId === thread.environmentId &&
          (context.threadId === undefined || context.threadId === thread.threadId),
        reason: "The command is hosted by another active thread.",
      }),
    );
  }, [thread, readPrompt, send]);
}
