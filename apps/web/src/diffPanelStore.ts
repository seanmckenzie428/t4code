import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

export type DiffRenderMode = "stacked" | "split";

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "unstaged" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  reviewedDiffFileRevisionsByScopeKey: Record<string, Record<string, string>>;
  diffRenderMode: DiffRenderMode;
  setDiffRenderMode: (mode: DiffRenderMode) => void;
  setReviewedDiffFileRevision: (
    scopeKey: string,
    filePath: string,
    revision: string | null,
  ) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: "branch" | "unstaged") => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      reviewedDiffFileRevisionsByScopeKey: {},
      diffRenderMode: "stacked",
      setDiffRenderMode: (diffRenderMode) => set({ diffRenderMode }),
      setReviewedDiffFileRevision: (scopeKey, filePath, revision) =>
        set((state) => {
          const currentScope = state.reviewedDiffFileRevisionsByScopeKey[scopeKey] ?? {};
          if (revision !== null && currentScope[filePath] === revision) return state;
          if (revision === null && !(filePath in currentScope)) return state;

          const nextScope = { ...currentScope };
          if (revision === null) delete nextScope[filePath];
          else nextScope[filePath] = revision;

          const reviewedDiffFileRevisionsByScopeKey = {
            ...state.reviewedDiffFileRevisionsByScopeKey,
          };
          if (Object.keys(nextScope).length === 0) {
            delete reviewedDiffFileRevisionsByScopeKey[scopeKey];
          } else {
            reviewedDiffFileRevisionsByScopeKey[scopeKey] = nextScope;
          }
          return { reviewedDiffFileRevisionsByScopeKey };
        }),
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "unstaged" },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const reviewScopePrefix = `${threadKey}:`;
          const hasReviewScopes = Object.keys(state.reviewedDiffFileRevisionsByScopeKey).some(
            (scopeKey) => scopeKey.startsWith(reviewScopePrefix),
          );
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.branchBaseRefByThreadKey) &&
            !hasReviewScopes
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          const reviewedDiffFileRevisionsByScopeKey = Object.fromEntries(
            Object.entries(state.reviewedDiffFileRevisionsByScopeKey).filter(
              ([scopeKey]) => !scopeKey.startsWith(reviewScopePrefix),
            ),
          );
          return {
            byThreadKey,
            branchBaseRefByThreadKey,
            reviewedDiffFileRevisionsByScopeKey,
          };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        reviewedDiffFileRevisionsByScopeKey: state.reviewedDiffFileRevisionsByScopeKey,
        diffRenderMode: state.diffRenderMode,
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return (
    byThreadKey[scopedThreadKey(ref)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}
