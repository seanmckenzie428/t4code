import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  AppViewManifest,
  AppViewProjectPinProposal,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { useMainViewStore } from "./mainViewStore";
import { useRightPanelStore } from "./rightPanelStore";

const APP_VIEW_STORAGE_KEY = "t3code:app-views:v1";

export interface ThreadAppViewState {
  readonly manifests: Record<string, AppViewManifest>;
}

interface AppViewStoreState {
  byThreadKey: Record<string, ThreadAppViewState>;
  personalByEnvironment: Record<string, Record<string, AppViewManifest>>;
  projectPinProposals: Record<string, AppViewProjectPinProposal>;
  present: (ref: ScopedThreadRef, manifest: AppViewManifest) => "created" | "replayed" | "conflict";
  update: (ref: ScopedThreadRef, manifest: AppViewManifest, expectedRevision: number) => boolean;
  remove: (ref: ScopedThreadRef, viewId: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
  pinPersonal: (ref: ScopedThreadRef, viewId: string) => boolean;
  openManifest: (ref: ScopedThreadRef, manifest: AppViewManifest) => boolean;
  openPersonal: (ref: ScopedThreadRef, viewId: string) => boolean;
  pinProject: (
    ref: ScopedThreadRef,
    viewId: string,
    projectId: ProjectId,
  ) => AppViewProjectPinProposal | null;
  unpinPersonal: (ref: ScopedThreadRef, viewId: string) => boolean;
  unpinProject: (ref: ScopedThreadRef, viewId: string, projectId: ProjectId) => boolean;
}

const EMPTY_THREAD_APP_VIEWS: ThreadAppViewState = { manifests: {} };
const EMPTY_APP_VIEW_MANIFESTS: Record<string, AppViewManifest> = {};

function manifestMatchesThread(ref: ScopedThreadRef, manifest: AppViewManifest): boolean {
  return manifest.scope.kind === "thread" && manifest.scope.threadId === ref.threadId;
}

export const useAppViewStore = create<AppViewStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      personalByEnvironment: {},
      projectPinProposals: {},
      present: (ref, manifest) => {
        if (!manifestMatchesThread(ref, manifest)) return "conflict";
        const threadKey = scopedThreadKey(ref);
        const current = get().byThreadKey[threadKey]?.manifests[manifest.id];
        if (current) {
          return JSON.stringify(current) === JSON.stringify(manifest) ? "replayed" : "conflict";
        }
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [threadKey]: {
              manifests: {
                ...(state.byThreadKey[threadKey]?.manifests ?? {}),
                [manifest.id]: manifest,
              },
            },
          },
        }));
        return "created";
      },
      update: (ref, manifest, expectedRevision) => {
        if (!manifestMatchesThread(ref, manifest)) return false;
        const threadKey = scopedThreadKey(ref);
        const current = get().byThreadKey[threadKey]?.manifests[manifest.id];
        if (
          !current ||
          current.revision !== expectedRevision ||
          manifest.revision <= current.revision
        ) {
          return false;
        }
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [threadKey]: {
              manifests: {
                ...(state.byThreadKey[threadKey]?.manifests ?? {}),
                [manifest.id]: manifest,
              },
            },
          },
        }));
        return true;
      },
      remove: (ref, viewId) => {
        const threadKey = scopedThreadKey(ref);
        const environmentKey = String(ref.environmentId);
        set((state) => {
          const threadState = state.byThreadKey[threadKey];
          const byThreadKey = { ...state.byThreadKey };
          if (threadState && viewId in threadState.manifests) {
            const { [viewId]: _removed, ...manifests } = threadState.manifests;
            if (Object.keys(manifests).length > 0) byThreadKey[threadKey] = { manifests };
            else delete byThreadKey[threadKey];
          }
          const personalByEnvironment = { ...state.personalByEnvironment };
          const environmentViews = personalByEnvironment[environmentKey];
          if (environmentViews && viewId in environmentViews) {
            const { [viewId]: _removed, ...remaining } = environmentViews;
            if (Object.keys(remaining).length > 0)
              personalByEnvironment[environmentKey] = remaining;
            else delete personalByEnvironment[environmentKey];
          }
          const projectPinProposals = Object.fromEntries(
            Object.entries(state.projectPinProposals).filter(
              ([id, proposal]) =>
                proposal.viewId !== viewId || !id.startsWith(`${ref.environmentId}:`),
            ),
          );
          return { byThreadKey, personalByEnvironment, projectPinProposals };
        });
        useRightPanelStore.getState().closeSurface(ref, `app-view:${viewId}`);
      },
      removeThread: (ref) => {
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          return { byThreadKey };
        });
        useMainViewStore.getState().removeThread(ref);
        useRightPanelStore.getState().removeThread(ref);
      },
      pinPersonal: (ref, viewId) => {
        const manifest = selectAppView(get().byThreadKey, ref, viewId);
        if (!manifest) return false;
        const environmentKey = String(ref.environmentId);
        const copy = { ...manifest, scope: { kind: "personal" as const } };
        set((state) => ({
          personalByEnvironment: {
            ...state.personalByEnvironment,
            [environmentKey]: {
              ...(state.personalByEnvironment[environmentKey] ?? {}),
              [viewId]: copy,
            },
          },
        }));
        return true;
      },
      openManifest: (ref, manifest) => {
        const threadKey = scopedThreadKey(ref);
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [threadKey]: {
              manifests: {
                ...(state.byThreadKey[threadKey]?.manifests ?? {}),
                [manifest.id]: {
                  ...manifest,
                  scope: { kind: "thread" as const, threadId: ref.threadId },
                },
              },
            },
          },
        }));
        useRightPanelStore.getState().openAppView(ref, manifest.id);
        return true;
      },
      openPersonal: (ref, viewId) => {
        const environmentView = get().personalByEnvironment[String(ref.environmentId)]?.[viewId];
        if (!environmentView) return false;
        return get().openManifest(ref, environmentView);
      },
      pinProject: (ref, viewId, projectId) => {
        const manifest = selectAppView(get().byThreadKey, ref, viewId);
        if (!manifest) return null;
        const proposal: AppViewProjectPinProposal = {
          id: `${ref.environmentId}:${projectId}:${viewId}:${manifest.revision}`,
          viewId: manifest.id,
          projectId,
          manifest: { ...manifest, scope: { kind: "project", projectId } },
          configPath: "t3.json",
          status: "pending-review",
        };
        set((state) => ({
          projectPinProposals: { ...state.projectPinProposals, [proposal.id]: proposal },
        }));
        return proposal;
      },
      unpinPersonal: (ref, viewId) => {
        const environmentKey = String(ref.environmentId);
        const current = get().personalByEnvironment[environmentKey];
        if (!current || !(viewId in current)) return false;
        set((state) => {
          const environmentViews = state.personalByEnvironment[environmentKey];
          if (!environmentViews) return state;
          const { [viewId]: _removed, ...remaining } = environmentViews;
          const personalByEnvironment = { ...state.personalByEnvironment };
          if (Object.keys(remaining).length === 0) delete personalByEnvironment[environmentKey];
          else personalByEnvironment[environmentKey] = remaining;
          return { personalByEnvironment };
        });
        return true;
      },
      unpinProject: (ref, viewId, projectId) => {
        const entry = Object.entries(get().projectPinProposals).find(
          ([, proposal]) =>
            proposal.viewId === viewId &&
            proposal.projectId === projectId &&
            proposal.id.startsWith(`${ref.environmentId}:`),
        );
        if (!entry) return false;
        set((state) => {
          const { [entry[0]]: _removed, ...projectPinProposals } = state.projectPinProposals;
          return { projectPinProposals };
        });
        return true;
      },
    }),
    {
      name: APP_VIEW_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        personalByEnvironment: state.personalByEnvironment,
        projectPinProposals: state.projectPinProposals,
      }),
    },
  ),
);

export function selectThreadAppViews(
  byThreadKey: Record<string, ThreadAppViewState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadAppViewState {
  if (!ref) return EMPTY_THREAD_APP_VIEWS;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_APP_VIEWS;
}

export function selectPersonalAppViews(
  personalByEnvironment: Record<string, Record<string, AppViewManifest>>,
  environmentId: ScopedThreadRef["environmentId"],
): Record<string, AppViewManifest> {
  return personalByEnvironment[String(environmentId)] ?? EMPTY_APP_VIEW_MANIFESTS;
}

export function selectAppView(
  byThreadKey: Record<string, ThreadAppViewState>,
  ref: ScopedThreadRef | null | undefined,
  viewId: string | null | undefined,
): AppViewManifest | null {
  if (!viewId) return null;
  return selectThreadAppViews(byThreadKey, ref).manifests[viewId] ?? null;
}

export function presentAppView(ref: ScopedThreadRef, manifest: AppViewManifest): boolean {
  if (!manifestMatchesThread(ref, manifest)) return false;
  const result = useAppViewStore.getState().present(ref, manifest);
  if (result === "conflict") return false;
  useRightPanelStore.getState().openAppView(ref, manifest.id);
  return true;
}
