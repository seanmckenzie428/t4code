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

export type MainView = "chat" | "review" | "pull-request";

interface MainViewStoreState {
  byThreadKey: Record<string, MainView>;
  pullRequestByThreadKey: Record<string, PullRequestSurface | null>;
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
  /** Clear an explicit selection and show the thread's first linked PR. */
  openPullRequests: (ref: ScopedThreadRef, expectedUserActionRevision?: number) => boolean;
  migrateThreadPullRequests: (ref: ScopedThreadRef) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function migrateMainViewState(persisted: unknown) {
  const legacy = persisted as {
    byThreadKey?: Record<string, string>;
    pullRequestsByThreadKey?: Record<string, PullRequestSurface[]>;
  } | null;
  const byThreadKey: Record<string, MainView> = {};
  const pullRequestByThreadKey: Record<string, PullRequestSurface | null> = {};
  for (const [threadKey, view] of Object.entries(legacy?.byThreadKey ?? {})) {
    byThreadKey[threadKey] = view === "chat" || view === "review" ? view : "pull-request";
    if (view === "pull-requests") pullRequestByThreadKey[threadKey] = null;
  }
  for (const [threadKey, surfaces] of Object.entries(legacy?.pullRequestsByThreadKey ?? {})) {
    if (legacy?.byThreadKey?.[threadKey] === "pull-requests") continue;
    pullRequestByThreadKey[threadKey] =
      surfaces.find((surface) => surface.id === legacy?.byThreadKey?.[threadKey]) ??
      surfaces.at(-1) ??
      null;
  }
  return { byThreadKey, pullRequestByThreadKey };
}

export const useMainViewStore = create<MainViewStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      pullRequestByThreadKey: {},
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
          return {
            byThreadKey: { ...state.byThreadKey, [threadKey]: "pull-request" },
            pullRequestByThreadKey: { ...state.pullRequestByThreadKey, [threadKey]: surface },
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
        if (
          expectedUserActionRevision !== undefined &&
          get().getUserActionRevision(ref) !== expectedUserActionRevision
        )
          return false;
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          return {
            byThreadKey: { ...state.byThreadKey, [threadKey]: "pull-request" },
            pullRequestByThreadKey: { ...state.pullRequestByThreadKey, [threadKey]: null },
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
          const selected = migrated.find((surface) => surface.id === panel.activeSurfaceId);
          const hasMainSelection = threadKey in state.byThreadKey;
          const hasMainPullRequest = threadKey in state.pullRequestByThreadKey;
          const existing = state.pullRequestByThreadKey[threadKey] ?? null;
          let remembered = existing;
          if (!hasMainSelection || !hasMainPullRequest) {
            if (selected) remembered = selected.kind === "pull-request" ? selected : null;
            else if (!hasMainPullRequest)
              remembered = migrated.findLast((surface) => surface.kind === "pull-request") ?? null;
          }
          return {
            byThreadKey:
              panel.isOpen && selected && !hasMainSelection
                ? { ...state.byThreadKey, [threadKey]: "pull-request" }
                : state.byThreadKey,
            pullRequestByThreadKey: {
              ...state.pullRequestByThreadKey,
              [threadKey]: remembered,
            },
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
            !(threadKey in state.pullRequestByThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey)
          )
            return state;
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedPullRequest, ...pullRequestByThreadKey } =
            state.pullRequestByThreadKey;
          const { [threadKey]: _removedRevision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          return { byThreadKey, pullRequestByThreadKey, userActionRevisionByThreadKey };
        }),
    }),
    {
      name: "t3code:main-view-state:v1",
      version: 2,
      migrate: migrateMainViewState,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        pullRequestByThreadKey: state.pullRequestByThreadKey,
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

export function selectThreadMainPullRequest(
  pullRequestByThreadKey: Record<string, PullRequestSurface | null>,
  ref: ScopedThreadRef | null | undefined,
): PullRequestSurface | null {
  if (!ref) return null;
  return pullRequestByThreadKey[scopedThreadKey(ref)] ?? null;
}

export function resolveActiveMainView(
  selectedView: MainView,
  reviewAvailable: boolean,
  pullRequest: PullRequestSurface | null = null,
  linkedPullRequestsAvailable = false,
): MainView {
  if (selectedView === "chat") return "chat";
  if (selectedView === "review") return reviewAvailable ? "review" : "chat";
  return pullRequest || linkedPullRequestsAvailable ? "pull-request" : "chat";
}
