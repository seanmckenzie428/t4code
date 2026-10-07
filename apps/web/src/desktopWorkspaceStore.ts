import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import type { MainView } from "./mainViewStore";
import type { RightPanelSurface, ThreadRightPanelState } from "./rightPanelStore";

export const DESKTOP_CORE_TABS = [
  "chat",
  "review",
  "pull-request",
  "browser",
  "files",
  "agents",
] as const;
export type DesktopTabId = (typeof DESKTOP_CORE_TABS)[number] | `surface:${string}`;
export interface DesktopWorkspace {
  selected: DesktopTabId;
  lastContent: DesktopTabId | null;
  browserId: string | null;
  fileId: string | null;
  surfaceOrder: string[];
  splitTabs: Partial<Record<DesktopTabId, boolean>>;
  chatWidth: number;
  composerCollapsed: boolean;
  dismissedReplyId: string | null;
  browserSessions?: Record<string, { epoch: string; snapshot: PreviewSessionSnapshot }>;
}

export const EMPTY_DESKTOP_WORKSPACE: DesktopWorkspace = {
  selected: "chat",
  lastContent: null,
  browserId: null,
  fileId: null,
  surfaceOrder: [],
  splitTabs: {},
  chatWidth: 420,
  composerCollapsed: true,
  dismissedReplyId: null,
};

export function desktopSurfaceId(workspace: DesktopWorkspace, tab = workspace.selected) {
  if (tab === "browser") return workspace.browserId;
  if (tab === "files") return workspace.fileId ?? "files";
  return tab.startsWith("surface:") ? tab.slice("surface:".length) : null;
}

export function desktopTabForSurface(workspace: DesktopWorkspace, id: string): DesktopTabId {
  if (id === workspace.browserId || id === "browser:new") return "browser";
  if (id === workspace.fileId || id === "files") return "files";
  return `surface:${id}`;
}

export function selectDesktopTab(
  workspace: DesktopWorkspace,
  selected: DesktopTabId,
): DesktopWorkspace {
  return {
    ...workspace,
    selected,
    lastContent: selected === "chat" ? workspace.lastContent : selected,
  };
}

/** Resource owners keep sessions alive; this store only owns desktop placement. */
export function reconcileDesktopWorkspace(
  workspace: DesktopWorkspace,
  surfaces: readonly RightPanelSurface[],
): DesktopWorkspace {
  const resources = surfaces.filter(
    (s) => !["terminal", "pull-request", "pull-requests", "files"].includes(s.kind),
  );
  const ids = new Set(resources.map((s) => s.id as string));
  const added = resources.filter((s) => !workspace.surfaceOrder.includes(s.id));
  const browserId =
    workspace.browserId && ids.has(workspace.browserId)
      ? workspace.browserId
      : (added.find((s) => s.kind === "preview")?.id ?? null);
  const fileId =
    workspace.fileId && ids.has(workspace.fileId)
      ? workspace.fileId
      : (added.find((s) => s.kind === "file")?.id ?? null);
  const surfaceOrder = [
    ...workspace.surfaceOrder.filter((id) => ids.has(id)),
    ...added.map((s) => s.id),
  ];
  const validTab = (tab: DesktopTabId) => !tab.startsWith("surface:") || ids.has(tab.slice(8));
  return {
    ...workspace,
    browserId,
    fileId,
    browserSessions: Object.fromEntries(
      Object.entries(workspace.browserSessions ?? {}).filter(([id]) => ids.has(id)),
    ),
    surfaceOrder,
    selected: validTab(workspace.selected) ? workspace.selected : "chat",
    lastContent:
      workspace.lastContent && validTab(workspace.lastContent) ? workspace.lastContent : null,
    splitTabs: Object.fromEntries(
      Object.entries(workspace.splitTabs).filter(([id]) => validTab(id as DesktopTabId)),
    ),
  };
}

/** Keep the saved content choice when width or availability temporarily shows Chat instead. */
export function desktopWorkspaceLayout(
  workspace: DesktopWorkspace,
  width: number,
  resolvedTab: DesktopTabId = workspace.selected,
) {
  const requestedSplit =
    workspace.selected !== "chat" && Boolean(workspace.splitTabs[workspace.selected]);
  const split = resolvedTab !== "chat" && requestedSplit && width >= 760;
  const activeTab = requestedSplit && !split ? "chat" : resolvedTab;
  return { activeTab, requestedSplit, split, floating: activeTab !== "chat" && !split };
}

interface DesktopWorkspaceStore {
  byThreadKey: Record<string, DesktopWorkspace>;
  initialize: (ref: ScopedThreadRef, main: MainView, panel: ThreadRightPanelState) => void;
  syncPanel: (ref: ScopedThreadRef, panel: ThreadRightPanelState, activate: boolean) => void;
  select: (ref: ScopedThreadRef, tab: DesktopTabId) => void;
  toggleSplit: (ref: ScopedThreadRef) => void;
  setCollapsed: (ref: ScopedThreadRef, collapsed: boolean) => void;
  setChatWidth: (ref: ScopedThreadRef, width: number) => void;
  dismissReply: (ref: ScopedThreadRef, messageId: string) => void;
  reorder: (ref: ScopedThreadRef, from: string, to: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
  rememberBrowser: (
    ref: ScopedThreadRef,
    surfaceId: string,
    epoch: string,
    snapshot: PreviewSessionSnapshot,
  ) => void;
}

export const useDesktopWorkspaceStore = create<DesktopWorkspaceStore>()(
  persist(
    (set) => {
      const update = (ref: ScopedThreadRef, fn: (state: DesktopWorkspace) => DesktopWorkspace) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: fn(
              state.byThreadKey[scopedThreadKey(ref)] ?? EMPTY_DESKTOP_WORKSPACE,
            ),
          },
        }));
      return {
        byThreadKey: {},
        rememberBrowser: (ref, surfaceId, epoch, snapshot) =>
          update(ref, (current) => {
            const previous = current.browserSessions?.[surfaceId];
            if (
              previous?.epoch === epoch &&
              JSON.stringify(previous.snapshot) === JSON.stringify(snapshot)
            )
              return current;
            return {
              ...current,
              browserSessions: { ...current.browserSessions, [surfaceId]: { epoch, snapshot } },
            };
          }),
        removeThread: (ref) =>
          set((state) => {
            const { [scopedThreadKey(ref)]: _removed, ...byThreadKey } = state.byThreadKey;
            return { byThreadKey };
          }),
        initialize: (ref, main, panel) =>
          update(ref, (current) => {
            if (useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)])
              return reconcileDesktopWorkspace(current, panel.surfaces);
            const next = reconcileDesktopWorkspace(current, panel.surfaces);
            const selected =
              main !== "chat"
                ? main
                : panel.isOpen &&
                    panel.activeSurfaceId &&
                    panel.surfaces.some(
                      (s) => s.id === panel.activeSurfaceId && s.kind !== "terminal",
                    )
                  ? desktopTabForSurface(next, panel.activeSurfaceId)
                  : main;
            return selectDesktopTab(next, selected);
          }),
        syncPanel: (ref, panel, activate) =>
          update(ref, (current) => {
            const next = reconcileDesktopWorkspace(current, panel.surfaces);
            return activate && panel.isOpen && panel.activeSurfaceId
              ? selectDesktopTab(next, desktopTabForSurface(next, panel.activeSurfaceId))
              : next;
          }),
        select: (ref, tab) => update(ref, (current) => selectDesktopTab(current, tab)),
        toggleSplit: (ref) =>
          update(ref, (current) => {
            const tab = current.selected === "chat" ? current.lastContent : current.selected;
            if (!tab) return current;
            return {
              ...selectDesktopTab(current, tab),
              splitTabs: {
                ...current.splitTabs,
                [tab]: current.selected === "chat" || !current.splitTabs[tab],
              },
              composerCollapsed: false,
            };
          }),
        setCollapsed: (ref, composerCollapsed) =>
          update(ref, (current) => ({ ...current, composerCollapsed })),
        setChatWidth: (ref, width) =>
          update(ref, (current) => ({
            ...current,
            chatWidth: Math.max(280, Math.min(960, width)),
          })),
        dismissReply: (ref, messageId) =>
          update(ref, (current) => ({ ...current, dismissedReplyId: messageId })),
        reorder: (ref, from, to) =>
          update(ref, (current) => {
            if (
              from === to ||
              !current.surfaceOrder.includes(from) ||
              !current.surfaceOrder.includes(to)
            )
              return current;
            const surfaceOrder = current.surfaceOrder.filter((id) => id !== from);
            surfaceOrder.splice(surfaceOrder.indexOf(to), 0, from);
            return { ...current, surfaceOrder };
          }),
      };
    },
    {
      name: "pilot:desktop-workspace:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
    },
  ),
);
