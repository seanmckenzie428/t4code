import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type MainView = "chat" | "review";

interface MainViewStoreState {
  byThreadKey: Record<string, MainView>;
  select: (ref: ScopedThreadRef, view: MainView) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

export const useMainViewStore = create<MainViewStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      select: (ref, view) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (state.byThreadKey[threadKey] === view) return state;
          return { byThreadKey: { ...state.byThreadKey, [threadKey]: view } };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          return { byThreadKey };
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
