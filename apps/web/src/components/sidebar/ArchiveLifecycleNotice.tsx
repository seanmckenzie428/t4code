import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRef, useState } from "react";

import { refreshArchivedThreadsForEnvironment } from "../../lib/archivedThreadsState";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { invokeThreadLifecycle } from "../../hooks/useThreadActions";

export function ArchiveLifecycleNotice(props: {
  readonly thread: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "title" | "archivedAt" | "archiveLifecycle"
  >;
}) {
  const archive = useAtomCommand(threadEnvironment.archive);
  const cancel = useAtomCommand(threadEnvironment.cancelArchive);
  const retryInFlight = useRef(false);
  const cancelInFlight = useRef(false);
  const [retryPending, setRetryPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const lifecycle = props.thread.archiveLifecycle;
  if (!lifecycle) return null;

  const input = { environmentId: props.thread.environmentId, input: { threadId: props.thread.id } };
  const action = lifecycle.direction === "archive" ? "archive" : "restore";
  const retry = async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetryPending(true);
    try {
      const target = scopeThreadRef(props.thread.environmentId, props.thread.id);
      if (lifecycle.direction === "archive" && props.thread.archivedAt !== null) {
        await archive(input);
      } else {
        await invokeThreadLifecycle(
          lifecycle.direction === "archive" ? "thread.archive" : "thread.unarchive",
          target,
          { threadId: target.threadId },
        );
      }
      refreshArchivedThreadsForEnvironment(props.thread.environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not retry ${action}`,
        description:
          error instanceof Error ? error.message : "The operation could not be completed.",
      });
    } finally {
      retryInFlight.current = false;
      setRetryPending(false);
    }
  };
  const cancelOperation = async () => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancelPending(true);
    try {
      await cancel(input);
      refreshArchivedThreadsForEnvironment(props.thread.environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not cancel ${action}`,
        description:
          error instanceof Error ? error.message : "The operation could not be completed.",
      });
    } finally {
      cancelInFlight.current = false;
      setCancelPending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
      <span role="status" className="min-w-0 text-muted-foreground">
        {lifecycle.status === "pending"
          ? lifecycle.direction === "archive"
            ? "Archiving…"
            : "Restoring…"
          : lifecycle.direction === "archive"
            ? "Archive failed. Retrying…"
            : "Restore failed. Retrying…"}
      </span>
      {lifecycle.status === "retrying" ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={retryPending || cancelPending}
          aria-label={`Retry ${action} for ${props.thread.title}`}
          onClick={() => void retry()}
        >
          Retry
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={cancelPending}
        aria-label={`Cancel ${action} for ${props.thread.title}`}
        onClick={() => void cancelOperation()}
      >
        Cancel
      </Button>
      {lifecycle.lastError ? (
        <span className="basis-full break-words text-destructive">{lifecycle.lastError}</span>
      ) : null}
    </div>
  );
}
