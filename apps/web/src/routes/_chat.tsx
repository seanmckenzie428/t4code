import { usePreviewOpen } from "../hooks/usePreviewOpen";
import { Outlet, createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { ThreadRouteView } from "../components/ThreadRouteView";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useClientSettings, useLegacySidebarEnabled } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isEditableFocused } from "../lib/editableFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { undoLatestThreadAction } from "../hooks/showThreadUndoNotice";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";
import {
  invokeKeybindingAppCommand,
  invokeWebAppCommand,
  registerWebAppCommandHandler,
} from "../appCommandRegistry";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const previewOpen = usePreviewOpen(routeThreadRef);
  useEffect(() => {
    const matchesRoute = (context: { environmentId: string; threadId?: string }) => ({
      available:
        routeThreadRef !== null &&
        context.environmentId === routeThreadRef.environmentId &&
        (context.threadId === undefined || context.threadId === routeThreadRef.threadId),
      reason: "No matching preview thread is active.",
    });
    const disposers = [
      registerWebAppCommandHandler(
        "ui.preview.refresh",
        () => dispatchPreviewAction("refresh"),
        matchesRoute,
      ),
      registerWebAppCommandHandler(
        "ui.preview.focus-url",
        () => dispatchPreviewAction("focus-url"),
        matchesRoute,
      ),
      registerWebAppCommandHandler(
        "ui.preview.zoom-in",
        () => dispatchPreviewAction("zoom-in"),
        matchesRoute,
      ),
      registerWebAppCommandHandler(
        "ui.preview.zoom-out",
        () => dispatchPreviewAction("zoom-out"),
        matchesRoute,
      ),
      registerWebAppCommandHandler(
        "ui.preview.reset-zoom",
        () => dispatchPreviewAction("reset-zoom"),
        matchesRoute,
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [routeThreadRef]);
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (command === "thread.undo") {
        if (event.repeat || isModelPickerOpen()) return;
        if (undoLatestThreadAction()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        const projectRef = activeThread
          ? { environmentId: activeThread.environmentId, projectId: activeThread.projectId }
          : activeDraftThread
            ? {
                environmentId: activeDraftThread.environmentId,
                projectId: activeDraftThread.projectId,
              }
            : defaultProjectRef;
        if (projectRef) {
          void invokeKeybindingAppCommand(
            command,
            { environmentId: projectRef.environmentId, projectId: projectRef.projectId },
            { projectId: projectRef.projectId, local: true },
          );
        }
        return;
      }

      if (command === "chat.newWithoutProject") {
        const environmentId = scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? primaryEnvironmentId,
        );
        if (environmentId === null) return;
        event.preventDefault();
        event.stopPropagation();
        void startScratchThread(environmentId);
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // Sidebar v2 routes creation through the command palette whenever
        // there is a real choice to make; v1 (and single-project setups)
        // keep the immediate contextual create.
        if (!legacySidebarEnabled && projectGroupCount > 1) {
          if (primaryEnvironmentId !== null) {
            void invokeWebAppCommand(
              "ui.palette.open",
              { environmentId: primaryEnvironmentId, source: "keybinding" },
              { open: "new-thread-in" },
            );
          }
          return;
        }
        const projectRef = activeThread
          ? { environmentId: activeThread.environmentId, projectId: activeThread.projectId }
          : activeDraftThread
            ? {
                environmentId: activeDraftThread.environmentId,
                projectId: activeDraftThread.projectId,
              }
            : defaultProjectRef;
        if (projectRef) {
          void invokeKeybindingAppCommand(
            command,
            { environmentId: projectRef.environmentId, projectId: projectRef.projectId },
            { projectId: projectRef.projectId },
          );
        }
        return;
      }

      if (command === "preview.open" || command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open Pilot in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        void invokeKeybindingAppCommand(command, {
          environmentId: routeThreadRef.environmentId,
          threadId: routeThreadRef.threadId,
        });
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        void invokeKeybindingAppCommand(command, {
          environmentId: routeThreadRef.environmentId,
          threadId: routeThreadRef.threadId,
        });
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    keybindings,
    defaultProjectRef,
    previewOpen,
    primaryEnvironmentId,
    projectGroupCount,
    primaryEnvironmentId,
    routeThreadRef,
    scratchEnvironmentId,
    selectedThreadKeysSize,
    startScratchThread,
    legacySidebarEnabled,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  // Both thread routes render here, not in their own leaf components, so the
  // draft-to-thread promotion keeps one ChatView mounted across the swap.
  const threadTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return (
    <>
      <ChatRouteGlobalShortcuts />
      {threadTarget ? <ThreadRouteView target={threadTarget} /> : <Outlet />}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
