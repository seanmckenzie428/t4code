import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { refreshArchivedThreadsForEnvironment } from "../archive/useArchivedThreadSnapshots";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

export function ArchiveLifecycleNotice(props: {
  readonly thread: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "title" | "archiveLifecycle"
  >;
}) {
  const archive = useAtomCommand(threadEnvironment.archive);
  const restore = useAtomCommand(threadEnvironment.unarchive);
  const cancel = useAtomCommand(threadEnvironment.cancelArchive);
  const { onThreadArchived } = useAdaptiveWorkspaceLayout();
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
      const result = await (lifecycle.direction === "archive" ? archive(input) : restore(input));
      if (result._tag === "Success" && lifecycle.direction === "archive") {
        onThreadArchived(props.thread);
      }
      refreshArchivedThreadsForEnvironment(props.thread.environmentId);
    } catch (error) {
      Alert.alert(
        `Could not retry ${action}`,
        error instanceof Error ? error.message : "The operation could not be completed.",
      );
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
      Alert.alert(
        `Could not cancel ${action}`,
        error instanceof Error ? error.message : "The operation could not be completed.",
      );
    } finally {
      cancelInFlight.current = false;
      setCancelPending(false);
    }
  };

  return (
    <View className="gap-1 py-1">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          {lifecycle.status === "pending"
            ? lifecycle.direction === "archive"
              ? "Archiving…"
              : "Restoring…"
            : lifecycle.direction === "archive"
              ? "Archive failed. Retrying…"
              : "Restore failed. Retrying…"}
        </Text>
        {lifecycle.status === "retrying" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry ${action} for ${props.thread.title}`}
            disabled={retryPending || cancelPending}
            onPress={() => void retry()}
            className="min-h-11 justify-center px-2 py-2 active:opacity-60 disabled:opacity-40"
          >
            <Text className="text-xs font-t3-medium text-foreground">Retry</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cancel ${action} for ${props.thread.title}`}
          disabled={cancelPending}
          onPress={() => void cancelOperation()}
          className="min-h-11 justify-center px-2 py-2 active:opacity-60 disabled:opacity-40"
        >
          <Text className="text-xs font-t3-medium text-foreground">Cancel</Text>
        </Pressable>
      </View>
      {lifecycle.lastError ? (
        <Text className="text-xs text-danger-foreground">{lifecycle.lastError}</Text>
      ) : null}
    </View>
  );
}
