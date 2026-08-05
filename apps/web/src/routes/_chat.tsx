import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClientSettings, useSidebarV2Enabled } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
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
  const sidebarV2Enabled = useSidebarV2Enabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
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
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
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
        },
      });

      if (isCommandPaletteOpen()) {
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

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // Sidebar v2 routes creation through the command palette whenever
        // there is a real choice to make; v1 (and single-project setups)
        // keep the immediate contextual create.
        if (sidebarV2Enabled && projectGroupCount > 1) {
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

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open T3 Code in the desktop app to use the in-app preview.",
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
    projectGroupCount,
    primaryEnvironmentId,
    routeThreadRef,
    selectedThreadKeysSize,
    sidebarV2Enabled,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
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
