import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type ProjectAppearanceIcon =
  | { readonly type: "lucide"; readonly name: string }
  | { readonly type: "image"; readonly dataUrl: string };

export interface ProjectAppearance {
  readonly name?: string;
  readonly icon?: ProjectAppearanceIcon;
}

interface ProjectAppearanceStoreState {
  readonly byKey: Readonly<Record<string, ProjectAppearance>>;
  readonly setForKeys: (keys: readonly string[], appearance: ProjectAppearance) => void;
}

export const useProjectAppearanceStore = create<ProjectAppearanceStoreState>()(
  persist(
    (set) => ({
      byKey: {},
      setForKeys: (keys, appearance) =>
        set((state) => {
          const byKey = { ...state.byKey };
          for (const key of keys) {
            if (appearance.name || appearance.icon) byKey[key] = appearance;
            else delete byKey[key];
          }
          return { byKey };
        }),
    }),
    {
      name: "t3code:project-appearance:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byKey: state.byKey }),
    },
  ),
);
