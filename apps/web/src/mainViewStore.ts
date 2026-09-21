import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type MainView = "chat" | "review";

interface MainViewStoreState {
  byThreadKey: Record<string, MainView>;
  userActionRevisionByThreadKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  select: (ref: ScopedThreadRef, view: MainView) => void;
  selectProactive: (
    ref: ScopedThreadRef,
    view: MainView,
    expectedUserActionRevision: number,
  ) => boolean;
  removeThread: (ref: ScopedThreadRef) => void;
}

export const useMainViewStore = create<MainViewStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
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
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey)
          )
            return state;
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedRevision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          return { byThreadKey, userActionRevisionByThreadKey };
        }),
    }),
    {
      name: "t3code:main-view-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
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

export function resolveActiveMainView(selectedView: MainView, reviewAvailable: boolean): MainView {
  return selectedView === "review" && !reviewAvailable ? "chat" : selectedView;
}
