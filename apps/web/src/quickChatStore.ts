import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { newThreadId } from "./lib/utils";

const STORAGE_KEY = "t3code:quick-chat:v1";

interface QuickChatEnvironmentState {
  readonly open: boolean;
  readonly threadId: ThreadId;
}

interface QuickChatStoreState {
  readonly byEnvironment: Readonly<Record<string, QuickChatEnvironmentState>>;
  readonly open: (environmentId: EnvironmentId) => void;
  readonly close: (environmentId: EnvironmentId) => void;
  readonly toggle: (environmentId: EnvironmentId) => void;
  readonly newChat: (environmentId: EnvironmentId) => void;
  readonly openThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  readonly forgetThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  readonly finishChat: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

function getOrCreate(
  current: Readonly<Record<string, QuickChatEnvironmentState>>,
  environmentId: EnvironmentId,
): QuickChatEnvironmentState {
  return current[String(environmentId)] ?? { open: false, threadId: newThreadId() };
}

export const useQuickChatStore = create<QuickChatStoreState>()(
  persist(
    (set) => ({
      byEnvironment: {},
      open: (environmentId) =>
        set((state) => {
          const current = getOrCreate(state.byEnvironment, environmentId);
          return {
            byEnvironment: {
              ...state.byEnvironment,
              [String(environmentId)]: { ...current, open: true },
            },
          };
        }),
      close: (environmentId) =>
        set((state) => {
          const current = getOrCreate(state.byEnvironment, environmentId);
          return {
            byEnvironment: {
              ...state.byEnvironment,
              [String(environmentId)]: { ...current, open: false },
            },
          };
        }),
      toggle: (environmentId) =>
        set((state) => {
          const current = getOrCreate(state.byEnvironment, environmentId);
          return {
            byEnvironment: {
              ...state.byEnvironment,
              [String(environmentId)]: { ...current, open: !current.open },
            },
          };
        }),
      newChat: (environmentId) =>
        set((state) => ({
          byEnvironment: {
            ...state.byEnvironment,
            [String(environmentId)]: { open: true, threadId: newThreadId() },
          },
        })),
      openThread: (environmentId, threadId) =>
        set((state) => ({
          byEnvironment: {
            ...state.byEnvironment,
            [String(environmentId)]: { open: true, threadId },
          },
        })),
      forgetThread: (environmentId, threadId) =>
        set((state) => {
          const key = String(environmentId);
          if (state.byEnvironment[key]?.threadId !== threadId) return state;
          return {
            byEnvironment: {
              ...state.byEnvironment,
              [key]: { open: false, threadId: newThreadId() },
            },
          };
        }),
      finishChat: (environmentId, threadId) =>
        set((state) => {
          const key = String(environmentId);
          if (state.byEnvironment[key]?.threadId !== threadId) return state;
          return {
            byEnvironment: {
              ...state.byEnvironment,
              [key]: { open: false, threadId: newThreadId() },
            },
          };
        }),
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

export function selectQuickChat(
  state: QuickChatStoreState,
  environmentId: EnvironmentId | null,
): QuickChatEnvironmentState | null {
  return environmentId === null ? null : (state.byEnvironment[String(environmentId)] ?? null);
}
