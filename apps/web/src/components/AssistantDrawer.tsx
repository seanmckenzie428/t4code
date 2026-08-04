import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { BotIcon, PanelRightCloseIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useAssistantDrawerStore, selectAssistantDrawerOpen } from "../assistantDrawerStore";
import { resolveShortcutCommand } from "../keybindings";
import { useActiveEnvironmentId } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  invokeKeybindingAppCommand,
  invokeWebAppCommand,
  registerWebAppCommandHandler,
} from "../appCommandRegistry";
import { useEnvironmentSettings } from "../hooks/useSettings";
import type { EnvironmentId } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useThread } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { threadEnvironment } from "../state/threads";
import { newMessageId } from "../lib/utils";

const ASSISTANT_DRAWER_MEDIA_QUERY = "(max-width: 980px)";

export function AssistantDrawerLayout({ children }: { children: ReactNode }) {
  const environmentId = useActiveEnvironmentId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const isOpen = useAssistantDrawerStore((state) =>
    selectAssistantDrawerOpen(state, environmentId),
  );

  useEffect(() => {
    if (environmentId === null) return;
    const disposers = [
      registerWebAppCommandHandler("assistant.open", () =>
        useAssistantDrawerStore.getState().open(environmentId),
      ),
      registerWebAppCommandHandler("assistant.close", () =>
        useAssistantDrawerStore.getState().close(environmentId),
      ),
      registerWebAppCommandHandler("assistant.toggle", () =>
        useAssistantDrawerStore.getState().toggle(environmentId),
      ),
      registerWebAppCommandHandler("assistant.focus", () => {
        useAssistantDrawerStore.getState().open(environmentId);
        window.requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("[data-assistant-composer]")?.focus(),
        );
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [environmentId]);

  useEffect(() => {
    if (environmentId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "assistant.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      void invokeKeybindingAppCommand("assistant.toggle", { environmentId });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [environmentId, keybindings]);

  return (
    <div
      data-assistant-open={isOpen ? "true" : "false"}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 overflow-hidden",
        isOpen && "min-[981px]:max-[1280px]:[&_[data-thread-work-panel]]:hidden",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {isOpen && environmentId !== null ? (
        <>
          <button
            type="button"
            aria-label="Close T3 Assistant"
            className="fixed inset-0 z-40 bg-black/30 min-[981px]:hidden"
            onClick={() =>
              void invokeWebAppCommand("assistant.close", {
                environmentId,
                source: "button",
              })
            }
          />
          <aside
            aria-label="T3 Assistant"
            data-assistant-drawer=""
            data-overlay-media={ASSISTANT_DRAWER_MEDIA_QUERY}
            className={cn(
              "z-40 flex min-h-0 w-[min(420px,calc(100vw-24px))] shrink-0 flex-col border-l border-border bg-background",
              "max-[980px]:fixed max-[980px]:inset-y-0 max-[980px]:right-0 max-[980px]:shadow-2xl",
            )}
          >
            <AssistantDrawerContent
              environmentId={environmentId}
              onClose={() =>
                void invokeWebAppCommand("assistant.close", {
                  environmentId,
                  source: "button",
                })
              }
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}

function AssistantDrawerContent({
  environmentId,
  onClose,
}: {
  environmentId: EnvironmentId;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const assistantThreadId = ThreadId.make(`t3-global-assistant-thread-${environmentId}`);
  // The assistant foundation is optional: disabled or unavailable environments do
  // not have a system thread. The shell index is authoritative for its existence,
  // so do not start the detail stream (and its HTTP bootstrap) until provisioning
  // publishes the thread shell.
  const assistantThread = useThread(scopeThreadRef(environmentId, assistantThreadId), {
    waitForShell: true,
  });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const assistantSettings = useEnvironmentSettings(
    environmentId,
    (settings) => settings.globalAssistant,
  );
  const configured = assistantSettings.enabled && assistantSettings.modelSelection !== null;
  const running = assistantThread?.latestTurn?.state === "running";
  const canSend = configured && assistantThread?.kind === "assistant" && !running;

  const send = async () => {
    const text = draft.trim();
    if (!canSend || !text || assistantSettings.modelSelection === null) return;
    setSendError(null);
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId: assistantThreadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection: assistantSettings.modelSelection,
        titleSeed: "T3 Assistant",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      setSendError("T3 Assistant refused to start. Check the server log and Codex profile status.");
      return;
    }
    setDraft("");
  };

  return (
    <>
      <header className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        <BotIcon className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">T3 Assistant</div>
          <div className="truncate text-[11px] text-muted-foreground">Control-only Codex</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close assistant"
          onClick={onClose}
        >
          <PanelRightCloseIcon className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {assistantThread && assistantThread.messages.length > 0 ? (
          <div className="flex flex-col gap-3" aria-label="T3 Assistant conversation">
            {assistantThread.messages
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
          <div className="m-auto max-w-sm text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
              <ShieldCheckIcon className="size-5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-medium">Environment assistant</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {configured
                ? assistantThread
                  ? "This assistant can inspect and control T3 only through the scoped T3 MCP surface."
                  : "Restart the environment to provision the isolated assistant, or check the server log for a Codex profile refusal."
                : "Choose a Codex instance and model in environment settings to enable this control-only assistant."}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              size="sm"
              render={<Link to="/settings/general" />}
            >
              Configure assistant
            </Button>
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
            data-assistant-composer=""
            aria-label="Message T3 Assistant"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask T3 Assistant…"
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
            (running
              ? "Assistant is working…"
              : "Actions still follow grants and confirmation policy.")}
        </p>
      </form>
    </>
  );
}
