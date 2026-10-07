import { useLayoutEffect } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { isElectron } from "../env";
import {
  EMPTY_DESKTOP_WORKSPACE,
  desktopSurfaceId,
  useDesktopWorkspaceStore,
  type DesktopTabId,
} from "../desktopWorkspaceStore";
import { setActivePreviewTab } from "../previewStateStore";
import { selectThreadMainView, useMainViewStore } from "../mainViewStore";
import { useRightPanelStore, type ThreadRightPanelState } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

const EMPTY_PANEL: ThreadRightPanelState = { isOpen: false, activeSurfaceId: null, surfaces: [] };

/** Select the resource in both workspace navigation and its owning browser store. */
export function selectDesktopWorkspaceTab(ref: ScopedThreadRef, tab: DesktopTabId) {
  const key = scopedThreadKey(ref);
  const main = useMainViewStore.getState();
  main.select(
    ref,
    tab === "chat" || tab === "review" || tab === "pull-request"
      ? tab
      : selectThreadMainView(main.byThreadKey, ref),
  );
  const workspace = useDesktopWorkspaceStore.getState().byThreadKey[key] ?? EMPTY_DESKTOP_WORKSPACE;
  const surfaceId = desktopSurfaceId(workspace, tab);
  const panel = useRightPanelStore.getState();
  const surface = panel.byThreadKey[key]?.surfaces.find((surface) => surface.id === surfaceId);
  if (surface) {
    panel.activateSurface(ref, surface.id);
    if (surface.kind === "preview" && surface.resourceId)
      setActivePreviewTab(ref, surface.resourceId);
  }
  useDesktopWorkspaceStore.getState().select(ref, tab);
}

/** Adapt existing resource-opening entry points without changing standalone web. */
export function useDesktopWorkspace(ref: ScopedThreadRef | null) {
  const key = ref ? scopedThreadKey(ref) : null;
  const workspace = useDesktopWorkspaceStore((state) =>
    key ? (state.byThreadKey[key] ?? EMPTY_DESKTOP_WORKSPACE) : EMPTY_DESKTOP_WORKSPACE,
  );
  const environmentId = ref?.environmentId;
  const threadId = ref?.threadId;
  useLayoutEffect(() => {
    if (!isElectron || !environmentId || !threadId) return;
    return connectDesktopWorkspace({ environmentId, threadId });
  }, [environmentId, threadId]);
  return workspace;
}

export function connectDesktopWorkspace(ref: ScopedThreadRef) {
  const key = scopedThreadKey(ref);
  const transferTerminals = () => {
    const panel = useRightPanelStore.getState().byThreadKey[key];
    const terminals = panel?.surfaces.filter((surface) => surface.kind === "terminal") ?? [];
    if (!panel || terminals.length === 0) return;
    const active = terminals.find((surface) => surface.id === panel.activeSurfaceId);
    useTerminalUiStateStore.getState().importPanelTerminals(ref, terminals, {
      activeTerminalId: active?.activeTerminalId ?? null,
      open: panel.isOpen && active !== undefined,
    });
    useRightPanelStore.setState((state) => {
      const current = state.byThreadKey[key];
      if (!current) return state;
      const surfaces = current.surfaces.filter((surface) => surface.kind !== "terminal");
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [key]: {
            ...current,
            surfaces,
            activeSurfaceId: surfaces.some((surface) => surface.id === current.activeSurfaceId)
              ? current.activeSurfaceId
              : null,
          },
        },
      };
    });
  };
  useMainViewStore.getState().migrateThreadPullRequests(ref);
  transferTerminals();
  useDesktopWorkspaceStore
    .getState()
    .initialize(
      ref,
      selectThreadMainView(useMainViewStore.getState().byThreadKey, ref),
      useRightPanelStore.getState().byThreadKey[key] ?? EMPTY_PANEL,
    );
  const unsubscribePanel = useRightPanelStore.subscribe((state, previous) => {
    const panel = state.byThreadKey[key] ?? EMPTY_PANEL;
    const before = previous.byThreadKey[key] ?? EMPTY_PANEL;
    if (
      panel === before &&
      state.userActionRevisionByThreadKey[key] === previous.userActionRevisionByThreadKey[key]
    )
      return;
    if (panel.surfaces.some((surface) => surface.kind === "terminal")) {
      transferTerminals();
      return;
    }
    const removedResource = before.surfaces.some(
      (surface) => !panel.surfaces.some((next) => next.id === surface.id),
    );
    const addedResource = panel.surfaces.some(
      (surface) => !before.surfaces.some((previous) => previous.id === surface.id),
    );
    const workspace = useDesktopWorkspaceStore.getState().byThreadKey[key];
    const selectedSurface = workspace
      ? before.surfaces.find((surface) => surface.id === desktopSurfaceId(workspace))
      : undefined;
    const nextActive = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId);
    // Restoration can merge an automation-opened tab into its original saved surface.
    const restoredSelection =
      selectedSurface?.kind === "preview" &&
      nextActive?.kind === "preview" &&
      selectedSurface.resourceId === nextActive.resourceId &&
      !panel.surfaces.some((surface) => surface.id === selectedSurface.id);
    const activate =
      restoredSelection ||
      (!(removedResource && !addedResource) &&
        (panel.activeSurfaceId !== before.activeSurfaceId ||
          state.userActionRevisionByThreadKey[key] !==
            previous.userActionRevisionByThreadKey[key]));
    if (activate) {
      // Opening content is a user selection, so delayed PR discovery must not steal it.
      const main = useMainViewStore.getState();
      main.select(ref, selectThreadMainView(main.byThreadKey, ref));
    }
    useDesktopWorkspaceStore.getState().syncPanel(ref, panel, activate);
    if (before.isOpen && !panel.isOpen && panel.surfaces === before.surfaces)
      useDesktopWorkspaceStore.getState().select(ref, "chat");
  });
  const unsubscribeMain = useMainViewStore.subscribe((state, previous) => {
    if (
      state.byThreadKey[key] !== previous.byThreadKey[key] ||
      state.userActionRevisionByThreadKey[key] !== previous.userActionRevisionByThreadKey[key]
    ) {
      useDesktopWorkspaceStore.getState().select(ref, selectThreadMainView(state.byThreadKey, ref));
    }
  });
  return () => {
    unsubscribePanel();
    unsubscribeMain();
  };
}
