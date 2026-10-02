import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { getDefaultCollapsedDiffFilePaths, getDiffFileReviewState } from "./lib/diffCollapse";
import { buildDiffFileReviewSnapshot, getRenderablePatch } from "./lib/diffRendering";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const OTHER_THREAD_REF = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);
const REVIEW_SCOPE = "environment-1:thread-1:unstaged";
const OTHER_REVIEW_SCOPE = "environment-1:thread-2:unstaged";

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      reviewedDiffFileRevisionsByScopeKey: {},
      diffRenderMode: "stacked",
    }),
  );

  it("keeps the selected render mode in panel and persisted state", async () => {
    useDiffPanelStore.getState().setDiffRenderMode("split");

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({ diffRenderMode: "split" });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({ diffRenderMode: "split" });

    useDiffPanelStore.setState({ diffRenderMode: "stacked" });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("persists reviewed file revisions across thread switches and rehydration", async () => {
    useDiffPanelStore
      .getState()
      .setReviewedDiffFileRevision(REVIEW_SCOPE, "src/app.ts", "revision-1");
    useDiffPanelStore
      .getState()
      .setReviewedDiffFileRevision(OTHER_REVIEW_SCOPE, "src/other.ts", "revision-2");

    expect(useDiffPanelStore.getState().reviewedDiffFileRevisionsByScopeKey).toMatchObject({
      [REVIEW_SCOPE]: { "src/app.ts": "revision-1" },
      [OTHER_REVIEW_SCOPE]: { "src/other.ts": "revision-2" },
    });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({
      reviewedDiffFileRevisionsByScopeKey: {
        [REVIEW_SCOPE]: { "src/app.ts": "revision-1" },
      },
    });

    useDiffPanelStore.setState({ reviewedDiffFileRevisionsByScopeKey: {} });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().reviewedDiffFileRevisionsByScopeKey[REVIEW_SCOPE]).toEqual({
      "src/app.ts": "revision-1",
    });
  });

  it.each([false, true])(
    "restores Viewed collapse and detects later edits (default collapsed: %s)",
    async (collapsedByDefault) => {
      const snapshot = (line: string) => {
        const patch = getRenderablePatch(
          [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-before",
            `+${line}`,
          ].join("\n"),
        );
        if (patch?.kind !== "files") throw new Error("Expected parsed patch");
        return buildDiffFileReviewSnapshot(patch.files, null);
      };
      const original = snapshot("after");
      const filePath = original.filePaths[0]!;
      useDiffPanelStore
        .getState()
        .setReviewedDiffFileRevision(REVIEW_SCOPE, filePath, original.revisions.get(filePath)!);

      const { name, storage } = useDiffPanelStore.persist.getOptions();
      if (!name) throw new Error("Expected diff panel persistence to have a storage name");
      const persisted = await storage?.getItem(name);
      if (!persisted) throw new Error("Expected persisted review");
      useDiffPanelStore.setState({ reviewedDiffFileRevisionsByScopeKey: {} });
      await storage?.setItem(name, persisted);
      await useDiffPanelStore.persist.rehydrate();

      const reviewed = new Map(
        Object.entries(
          useDiffPanelStore.getState().reviewedDiffFileRevisionsByScopeKey[REVIEW_SCOPE] ?? {},
        ),
      );
      expect(
        getDefaultCollapsedDiffFilePaths(
          original.filePaths,
          original.revisions,
          reviewed,
          collapsedByDefault,
        ).has(filePath),
      ).toBe(true);
      expect(getDiffFileReviewState(filePath, original.revisions.get(filePath)!, reviewed)).toBe(
        "viewed",
      );

      const edited = snapshot("changed again");
      expect(
        getDefaultCollapsedDiffFilePaths(
          edited.filePaths,
          edited.revisions,
          reviewed,
          collapsedByDefault,
        ).has(filePath),
      ).toBe(false);
      expect(getDiffFileReviewState(filePath, edited.revisions.get(filePath)!, reviewed)).toBe(
        "changed",
      );
      expect(reviewed.get(filePath)).toBe(original.revisions.get(filePath));
    },
  );

  it("removes reviewed revisions with their thread only", () => {
    const store = useDiffPanelStore.getState();
    store.setReviewedDiffFileRevision(REVIEW_SCOPE, "src/app.ts", "revision-1");
    store.setReviewedDiffFileRevision(OTHER_REVIEW_SCOPE, "src/other.ts", "revision-2");
    store.removeThread(THREAD_REF);

    expect(useDiffPanelStore.getState().reviewedDiffFileRevisionsByScopeKey).toEqual({
      [OTHER_REVIEW_SCOPE]: { "src/other.ts": "revision-2" },
    });

    useDiffPanelStore.getState().removeThread(OTHER_THREAD_REF);
    expect(useDiffPanelStore.getState().reviewedDiffFileRevisionsByScopeKey).toEqual({});
  });

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "unstaged" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, RunId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("clears a thread's turn and file when selecting working tree without changing another thread's branch base", () => {
    const otherThreadRef = scopeThreadRef(
      EnvironmentId.make("environment-1"),
      ThreadId.make("thread-2"),
    );
    const store = useDiffPanelStore.getState();
    store.selectBranchBaseRef(THREAD_REF, "origin/release");
    store.selectTurn(THREAD_REF, RunId.make("turn-1"), "src/app.ts");
    store.selectBranchBaseRef(otherThreadRef, "origin/main");

    store.selectGitScope(THREAD_REF, "unstaged");

    const { byThreadKey } = useDiffPanelStore.getState();
    expect(selectThreadDiffPanelSelection(byThreadKey, THREAD_REF)).toEqual({ kind: "unstaged" });
    expect(selectThreadDiffPanelSelection(byThreadKey, otherThreadRef)).toEqual({
      kind: "branch",
      baseRef: "origin/main",
    });

    store.selectGitScope(THREAD_REF, "branch");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/release" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = RunId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = RunId.make("turn-missing");
    const latestTurnId = RunId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });
});
