import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  PULL_REQUESTS_PANEL_REF,
  pullRequestSurface,
  useRightPanelStore,
  type PullRequestSurface,
} from "./rightPanelStore";

export type MainView = "chat" | "review" | "pull-requests" | PullRequestSurface["id"];

interface MainViewStoreState {
  byThreadKey: Record<string, MainView>;
  pullRequestsByThreadKey: Record<string, PullRequestSurface[]>;
  userActionRevisionByThreadKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  select: (ref: ScopedThreadRef, view: MainView) => void;
  selectProactive: (
    ref: ScopedThreadRef,
    view: MainView,
    expectedUserActionRevision: number,
  ) => boolean;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: Parameters<typeof pullRequestSurface>[0],
    expectedUserActionRevision?: number,
  ) => boolean;
  openPullRequests: (ref: ScopedThreadRef, expectedUserActionRevision?: number) => boolean;
  closePullRequest: (ref: ScopedThreadRef, id: PullRequestSurface["id"]) => void;
  migrateThreadPullRequests: (ref: ScopedThreadRef) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_PULL_REQUESTS: readonly PullRequestSurface[] = [];

export const useMainViewStore = create<MainViewStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      pullRequestsByThreadKey: {},
      userActionRevisionByThreadKey: {},
      getUserActionRevision: (ref) =>
        get().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0,
      select: (ref, view) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          return {
            byThreadKey: { ...state.byThreadKey, [threadKey]: view },
            userActionRevisionByThreadKey: {
              ...state.userActionRevisionByThreadKey,
              [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
            },
          };
        }),
      selectProactive: (ref, view, expectedUserActionRevision) => {
        if (get().getUserActionRevision(ref) !== expectedUserActionRevision) return false;
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (state.byThreadKey[threadKey] === view) return state;
          return { byThreadKey: { ...state.byThreadKey, [threadKey]: view } };
        });
        return true;
      },
      openPullRequest: (ref, target, expectedUserActionRevision) => {
        if (
          expectedUserActionRevision !== undefined &&
          get().getUserActionRevision(ref) !== expectedUserActionRevision
        )
          return false;
        const surface = pullRequestSurface(target);
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const current = state.pullRequestsByThreadKey[threadKey] ?? [];
          const surfaces = current.some((entry) => entry.id === surface.id)
            ? current.map((entry) => (entry.id === surface.id ? surface : entry))
            : [...current, surface];
          return {
            byThreadKey: { ...state.byThreadKey, [threadKey]: surface.id },
            pullRequestsByThreadKey: { ...state.pullRequestsByThreadKey, [threadKey]: surfaces },
            ...(expectedUserActionRevision === undefined
              ? {
                  userActionRevisionByThreadKey: {
                    ...state.userActionRevisionByThreadKey,
                    [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
                  },
                }
              : {}),
          };
        });
        return true;
      },
      openPullRequests: (ref, expectedUserActionRevision) => {
        if (expectedUserActionRevision !== undefined) {
          return get().selectProactive(ref, "pull-requests", expectedUserActionRevision);
        }
        get().select(ref, "pull-requests");
        return true;
      },
      closePullRequest: (ref, id) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const current = state.pullRequestsByThreadKey[threadKey] ?? [];
          const index = current.findIndex((surface) => surface.id === id);
          if (index === -1) return state;
          const remaining = current.filter((surface) => surface.id !== id);
          const pullRequestsByThreadKey = { ...state.pullRequestsByThreadKey };
          if (remaining.length > 0) pullRequestsByThreadKey[threadKey] = remaining;
          else delete pullRequestsByThreadKey[threadKey];
          return {
            byThreadKey:
              state.byThreadKey[threadKey] === id
                ? {
                    ...state.byThreadKey,
                    [threadKey]: remaining[Math.min(index, remaining.length - 1)]?.id ?? "chat",
                  }
                : state.byThreadKey,
            pullRequestsByThreadKey,
            userActionRevisionByThreadKey: {
              ...state.userActionRevisionByThreadKey,
              [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
            },
          };
        }),
      migrateThreadPullRequests: (ref) => {
        const threadKey = scopedThreadKey(ref);
        if (threadKey === scopedThreadKey(PULL_REQUESTS_PANEL_REF)) return;
        const panel = useRightPanelStore.getState().byThreadKey[threadKey];
        if (!panel) return;
        const migrated = panel.surfaces.filter(
          (surface) => surface.kind === "pull-request" || surface.kind === "pull-requests",
        );
        if (migrated.length === 0) return;
        set((state) => {
          const existing = state.pullRequestsByThreadKey[threadKey] ?? [];
          const surfaces = [
            ...existing,
            ...migrated.filter(
              (surface): surface is PullRequestSurface =>
                surface.kind === "pull-request" &&
                !existing.some((entry) => entry.id === surface.id),
            ),
          ];
          const selected = migrated.find((surface) => surface.id === panel.activeSurfaceId);
          return {
            byThreadKey:
              panel.isOpen && selected && (state.byThreadKey[threadKey] ?? "chat") === "chat"
                ? { ...state.byThreadKey, [threadKey]: selected.id }
                : state.byThreadKey,
            pullRequestsByThreadKey:
              surfaces.length > 0
                ? { ...state.pullRequestsByThreadKey, [threadKey]: surfaces }
                : state.pullRequestsByThreadKey,
          };
        });
        useRightPanelStore.setState((state) => {
          const current = state.byThreadKey[threadKey];
          if (!current) return state;
          const surfaces = current.surfaces.filter(
            (surface) => surface.kind !== "pull-request" && surface.kind !== "pull-requests",
          );
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                ...current,
                surfaces,
                isOpen: current.isOpen && surfaces.length > 0,
                activeSurfaceId: surfaces.some((surface) => surface.id === current.activeSurfaceId)
                  ? current.activeSurfaceId
                  : (surfaces[0]?.id ?? null),
              },
            },
          };
        });
      },
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.pullRequestsByThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey)
          )
            return state;
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedPullRequests, ...pullRequestsByThreadKey } =
            state.pullRequestsByThreadKey;
          const { [threadKey]: _removedRevision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          return { byThreadKey, pullRequestsByThreadKey, userActionRevisionByThreadKey };
        }),
    }),
    {
      name: "t3code:main-view-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        pullRequestsByThreadKey: state.pullRequestsByThreadKey,
      }),
    },
  ),
);

export function selectThreadMainView(
  byThreadKey: Record<string, MainView>,
  ref: ScopedThreadRef | null | undefined,
): MainView {
  if (!ref) return "chat";
  return byThreadKey[scopedThreadKey(ref)] ?? "chat";
}

export function selectThreadMainPullRequests(
  pullRequestsByThreadKey: Record<string, PullRequestSurface[]>,
  ref: ScopedThreadRef | null | undefined,
): readonly PullRequestSurface[] {
  if (!ref) return EMPTY_PULL_REQUESTS;
  return pullRequestsByThreadKey[scopedThreadKey(ref)] ?? EMPTY_PULL_REQUESTS;
}

export function resolveActiveMainView(
  selectedView: MainView,
  reviewAvailable: boolean,
  pullRequests: readonly PullRequestSurface[] = EMPTY_PULL_REQUESTS,
  linkedPullRequestsAvailable = false,
): MainView {
  if (selectedView === "chat") return "chat";
  if (selectedView === "review") return reviewAvailable ? "review" : "chat";
  if (selectedView === "pull-requests") return linkedPullRequestsAvailable ? selectedView : "chat";
  return pullRequests.some((surface) => surface.id === selectedView) ? selectedView : "chat";
}
