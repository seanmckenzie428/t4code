import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const STORAGE_KEY = "t3code:assistant-drawer:v1";

interface AssistantDrawerEnvironmentState {
  readonly open: boolean;
}

interface AssistantDrawerStoreState {
  readonly byEnvironment: Readonly<Record<string, AssistantDrawerEnvironmentState>>;
  readonly open: (environmentId: EnvironmentId) => void;
  readonly close: (environmentId: EnvironmentId) => void;
  readonly toggle: (environmentId: EnvironmentId) => void;
}

function updateEnvironment(
  current: Readonly<Record<string, AssistantDrawerEnvironmentState>>,
  environmentId: EnvironmentId,
  open: boolean,
): Readonly<Record<string, AssistantDrawerEnvironmentState>> {
  const key = String(environmentId);
  if (current[key]?.open === open) return current;
  return { ...current, [key]: { open } };
}

export const useAssistantDrawerStore = create<AssistantDrawerStoreState>()(
  persist(
    (set) => ({
      byEnvironment: {},
      open: (environmentId) =>
        set((state) => ({
          byEnvironment: updateEnvironment(state.byEnvironment, environmentId, true),
        })),
      close: (environmentId) =>
        set((state) => ({
          byEnvironment: updateEnvironment(state.byEnvironment, environmentId, false),
        })),
      toggle: (environmentId) =>
        set((state) => ({
          byEnvironment: updateEnvironment(
            state.byEnvironment,
            environmentId,
            !(state.byEnvironment[String(environmentId)]?.open ?? false),
          ),
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byEnvironment: state.byEnvironment }),
    },
  ),
);

export function selectAssistantDrawerOpen(
  state: AssistantDrawerStoreState,
  environmentId: EnvironmentId | null,
): boolean {
  return environmentId === null
    ? false
    : (state.byEnvironment[String(environmentId)]?.open ?? false);
}
