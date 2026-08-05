import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ProjectId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { MessageCircleIcon, PlusIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  invokeKeybindingAppCommand,
  invokeWebAppCommand,
  registerWebAppCommandHandler,
} from "../appCommandRegistry";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { resolveShortcutCommand } from "../keybindings";
import { cn, newMessageId } from "../lib/utils";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { selectQuickChat, useQuickChatStore } from "../quickChatStore";
import { isQuickChatCloseEvent } from "../quickChatKeyboard";
import { useThread } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function QuickChatPopup({ environmentId }: { environmentId: EnvironmentId }) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const quickChat = useQuickChatStore((state) => selectQuickChat(state, environmentId));
  const isOpen = quickChat?.open ?? false;
  const quickThread = useThread(
    quickChat ? scopeThreadRef(environmentId, quickChat.threadId) : null,
  );
  const quickThreadId = quickChat?.threadId ?? null;
  const quickThreadExists = quickThread !== null;
  const archiveQuickThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });

  useEffect(() => {
    const open = () => {
      useQuickChatStore.getState().open(environmentId);
    };
    const close = async () => {
      if (quickThreadId === null || !quickThreadExists) {
        useQuickChatStore.getState().close(environmentId);
        return;
      }
      const result = await archiveQuickThread({
        environmentId,
        input: { threadId: quickThreadId },
      });
      if (result._tag === "Failure") {
        useQuickChatStore.getState().close(environmentId);
        return;
      }
      refreshArchivedThreadsForEnvironment(environmentId);
      useQuickChatStore.getState().finishChat(environmentId, quickThreadId);
    };
    const disposers = [
      registerWebAppCommandHandler("quick-chat.open", (invocation) => {
        const args = invocation.args;
        const threadId =
          typeof args === "object" && args !== null && "threadId" in args
            ? args.threadId
            : undefined;
        if (typeof threadId === "string") {
          useQuickChatStore.getState().openThread(environmentId, threadId as ThreadId);
        } else {
          useQuickChatStore.getState().open(environmentId);
        }
      }),
      registerWebAppCommandHandler("quick-chat.close", close),
      registerWebAppCommandHandler("quick-chat.toggle", async () => {
        if (useQuickChatStore.getState().byEnvironment[String(environmentId)]?.open) {
          await close();
        } else {
          useQuickChatStore.getState().open(environmentId);
        }
      }),
      registerWebAppCommandHandler("quick-chat.focus", () => {
        open();
        window.requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("[data-quick-chat-composer]")?.focus(),
        );
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [archiveQuickThread, environmentId, quickThreadExists, quickThreadId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isQuickChatCloseEvent(event, isOpen)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void invokeWebAppCommand("quick-chat.close", { environmentId, source: "keybinding" });
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "quickChat.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      void invokeKeybindingAppCommand("quickChat.toggle", { environmentId });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [environmentId, isOpen, keybindings]);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {isOpen && quickChat ? (
        <section
          aria-label="Quick Chat"
          data-quick-chat-floating=""
          className="pointer-events-auto flex h-[min(520px,calc(100dvh-88px))] min-h-80 w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        >
          <QuickChatContent environmentId={environmentId} threadId={quickChat.threadId} />
        </section>
      ) : null}
      <Button
        type="button"
        size="icon-lg"
        variant="secondary"
        aria-label={isOpen ? "Close Quick Chat" : "Open Quick Chat"}
        aria-pressed={isOpen}
        className="pointer-events-auto rounded-full shadow-lg"
        onClick={() =>
          void invokeWebAppCommand("quick-chat.toggle", { environmentId, source: "button" })
        }
      >
        {isOpen ? <XIcon className="size-4" /> : <MessageCircleIcon className="size-4" />}
      </Button>
    </div>
  );
}

function QuickChatContent({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const thread = useThread(scopeThreadRef(environmentId, threadId));
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const stopSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const modelSelection = useEnvironmentSettings(
    environmentId,
    (settings) => settings.globalAssistant.modelSelection,
  );
  const running = thread?.latestTurn?.state === "running";
  const canSend = modelSelection !== null && !running;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [threadId]);

  const send = async () => {
    const text = draft.trim();
    if (!canSend || !text || modelSelection === null) return;
    setSendError(null);
    const createdAt = new Date().toISOString();
    const title = text.replaceAll(/\s+/g, " ").slice(0, 60) || "Quick Chat";
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection,
        titleSeed: title,
        runtimeMode: "approval-required",
        interactionMode: "default",
        ...(thread === null
          ? {
              bootstrap: {
                createThread: {
                  projectId: ProjectId.make(`t3-quick-chat-project-${environmentId}`),
                  kind: "quick" as const,
                  title,
                  modelSelection,
                  runtimeMode: "approval-required" as const,
                  interactionMode: "default" as const,
                  branch: null,
                  worktreePath: null,
                  createdAt,
                },
              },
            }
          : {}),
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      setSendError("Quick Chat could not start. Check the selected model and server log.");
      return;
    }
    setDraft("");
  };

  const newChat = async () => {
    if (thread !== null) {
      if (thread.session !== null && thread.session.status !== "stopped") {
        const stopResult = await stopSession({ environmentId, input: { threadId } });
        if (stopResult._tag === "Failure") {
          setSendError("Quick Chat could not stop the current conversation.");
          return;
        }
      }
      const archiveResult = await archiveThread({ environmentId, input: { threadId } });
      if (archiveResult._tag === "Failure") {
        setSendError("Quick Chat could not save the current conversation.");
        return;
      }
      refreshArchivedThreadsForEnvironment(environmentId);
    }
    setDraft("");
    setSendError(null);
    useQuickChatStore.getState().newChat(environmentId);
  };

  return (
    <>
      <header className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageCircleIcon className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Quick Chat</div>
          <div className="truncate text-[11px] text-muted-foreground">
            Environment-wide control · no project attached
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New quick chat"
          onClick={() => void newChat()}
        >
          <PlusIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close Quick Chat"
          onClick={() =>
            void invokeWebAppCommand("quick-chat.close", { environmentId, source: "button" })
          }
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {thread && thread.messages.length > 0 ? (
          <div className="flex flex-col gap-3" aria-label="Quick Chat conversation">
            {thread.messages
              .filter((message) => message.role !== "system")
              .map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed",
                    message.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "mr-auto bg-muted text-foreground",
                  )}
                >
                  {message.text}
                </div>
              ))}
          </div>
        ) : (
          <div className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
            Ask anything without attaching the conversation to a project.
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <Textarea
            ref={composerRef}
            data-quick-chat-composer=""
            aria-label="Message Quick Chat"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void send();
            }}
            placeholder={
              modelSelection === null ? "Select a Quick Chat model first…" : "Ask anything…"
            }
            disabled={!canSend}
            className="min-h-9 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend || !draft.trim()}
            aria-label="Send message"
          >
            <SendIcon className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          {sendError ??
            (running ? "Quick Chat is working…" : "Ctrl/⌘ Shift Space toggles Quick Chat")}
        </p>
      </form>
    </>
  );
}
