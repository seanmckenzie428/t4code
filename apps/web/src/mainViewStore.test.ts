import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  resolveActiveMainView,
  selectThreadMainPullRequests,
  selectThreadMainView,
  useMainViewStore,
} from "./mainViewStore";
import { PULL_REQUESTS_PANEL_REF, pullRequestSurface, useRightPanelStore } from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const refOtherEnvironment = scopeThreadRef(EnvironmentId.make("env-2"), refA.threadId);
const firstPr = { projectId: "project-1", repository: "owner/repo", number: 1 };
const secondPr = { ...firstPr, number: 2 };

beforeEach(() => {
  useMainViewStore.setState({
    byThreadKey: {},
    pullRequestsByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("mainViewStore", () => {
  it("defaults each thread to chat", () => {
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("keeps the selected view scoped to its thread", () => {
    useMainViewStore.getState().select(refA, "review");

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("review");
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refB)).toBe("chat");
  });

  it("keeps chat selected when a completed turn tries to reopen review after a user choice", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.select(refA, "review");
    const revisionAtTurnStart = mainViews.getUserActionRevision(refA);

    mainViews.select(refA, "chat");

    expect(mainViews.selectProactive(refA, "review", revisionAtTurnStart)).toBe(false);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("treats an explicit choice of the current chat view as user intent", () => {
    const mainViews = useMainViewStore.getState();
    const revisionAtTurnStart = mainViews.getUserActionRevision(refA);

    mainViews.select(refA, "chat");

    expect(mainViews.selectProactive(refA, "review", revisionAtTurnStart)).toBe(false);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("allows a later turn to open review without treating automatic selection as user intent", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.select(refA, "chat");
    const revisionAtTurnStart = mainViews.getUserActionRevision(refA);
    mainViews.select(refB, "review");

    expect(mainViews.selectProactive(refA, "review", revisionAtTurnStart)).toBe(true);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("review");
    expect(mainViews.getUserActionRevision(refA)).toBe(revisionAtTurnStart);
  });

  it("removes saved state with the thread", () => {
    useMainViewStore.getState().select(refA, "review");
    useMainViewStore.getState().removeThread(refA);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
    expect(useMainViewStore.getState().getUserActionRevision(refA)).toBe(0);
  });

  it("falls back to chat when review is unavailable", () => {
    expect(resolveActiveMainView("review", false)).toBe("chat");
    expect(resolveActiveMainView("review", true)).toBe("review");
  });

  it("keeps several PR tabs open while switching views and reopening a PR", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequest(refA, secondPr);
    mainViews.select(refA, "review");
    mainViews.openPullRequest(refA, { ...firstPr, url: "https://github.com/owner/repo/pull/1" });

    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe(pullRequestSurface(firstPr).id);
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refA)).toEqual([
      pullRequestSurface({ ...firstPr, url: "https://github.com/owner/repo/pull/1" }),
      pullRequestSurface(secondPr),
    ]);
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refB)).toEqual([]);
    expect(
      selectThreadMainPullRequests(state.pullRequestsByThreadKey, refOtherEnvironment),
    ).toEqual([]);
  });

  it("closes an active PR to its neighbor, then returns to Chat after the last closes", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequest(refA, secondPr);
    mainViews.openPullRequest(refA, firstPr);
    mainViews.closePullRequest(refA, pullRequestSurface(firstPr).id);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      pullRequestSurface(secondPr).id,
    );

    mainViews.closePullRequest(refA, pullRequestSurface(secondPr).id);
    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("chat");
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refA)).toEqual([]);
  });

  it("keeps the selected view when another PR tab closes", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.select(refA, "review");
    mainViews.closePullRequest(refA, pullRequestSurface(firstPr).id);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("review");
  });

  it("protects explicit PR opens and closes from a completed turn changing the view", () => {
    const mainViews = useMainViewStore.getState();
    const revisionAtTurnStart = mainViews.getUserActionRevision(refA);
    mainViews.openPullRequest(refA, firstPr);
    expect(mainViews.selectProactive(refA, "review", revisionAtTurnStart)).toBe(false);

    const revisionAfterOpen = mainViews.getUserActionRevision(refA);
    mainViews.closePullRequest(refA, pullRequestSurface(firstPr).id);
    expect(mainViews.openPullRequest(refA, firstPr, revisionAfterOpen)).toBe(false);
    expect(mainViews.openPullRequests(refA, revisionAfterOpen)).toBe(false);
    expect(
      selectThreadMainPullRequests(useMainViewStore.getState().pullRequestsByThreadKey, refA),
    ).toEqual([]);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("opens proactive PR views without advancing user intent", () => {
    const mainViews = useMainViewStore.getState();
    const revision = mainViews.getUserActionRevision(refA);
    expect(mainViews.openPullRequest(refA, firstPr, revision)).toBe(true);
    expect(mainViews.openPullRequests(refA, revision)).toBe(true);
    expect(mainViews.getUserActionRevision(refA)).toBe(revision);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-requests",
    );

    mainViews.openPullRequests(refA);
    expect(mainViews.selectProactive(refA, "review", revision)).toBe(false);
  });

  it("restores persisted PR tabs without restoring session-only intent revisions", async () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    const options = useMainViewStore.persist.getOptions();
    if (!options.name || !options.storage) throw new Error("Persistence is not configured");
    const persisted = await options.storage.getItem(options.name);
    if (!persisted) throw new Error("PR tabs were not persisted");
    expect(persisted.state).toEqual({
      byThreadKey: { [scopedThreadKey(refA)]: pullRequestSurface(firstPr).id },
      pullRequestsByThreadKey: { [scopedThreadKey(refA)]: [pullRequestSurface(firstPr)] },
    });
    useMainViewStore.setState({
      byThreadKey: {},
      pullRequestsByThreadKey: {},
      userActionRevisionByThreadKey: {},
    });
    await options.storage.setItem(options.name, persisted);
    await useMainViewStore.persist.rehydrate();

    expect(
      selectThreadMainPullRequests(useMainViewStore.getState().pullRequestsByThreadKey, refA),
    ).toEqual([pullRequestSurface(firstPr)]);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      pullRequestSurface(firstPr).id,
    );
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
  });

  it("removes only the deleted thread's PR tabs", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequest(refB, secondPr);
    mainViews.removeThread(refA);

    const state = useMainViewStore.getState();
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refA)).toEqual([]);
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("chat");
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refB)).toEqual([
      pullRequestSurface(secondPr),
    ]);
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
  });

  it("falls back to Chat when the selected PR or linked list is unavailable", () => {
    const surface = pullRequestSurface(firstPr);
    expect(resolveActiveMainView(surface.id, true)).toBe("chat");
    expect(resolveActiveMainView(surface.id, true, [surface])).toBe(surface.id);
    expect(resolveActiveMainView("pull-requests", true)).toBe("chat");
    expect(resolveActiveMainView("pull-requests", true, [], true)).toBe("pull-requests");
  });

  it("moves saved sidebar PR tabs to the main view without dismissing other panels", () => {
    const panels = useRightPanelStore.getState();
    panels.open(refA, "files");
    panels.openPullRequest(refA, firstPr);
    const panelRevision = panels.getUserActionRevision(refA);
    const mainViews = useMainViewStore.getState();
    mainViews.migrateThreadPullRequests(refA);
    mainViews.migrateThreadPullRequests(refA);

    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe(pullRequestSurface(firstPr).id);
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refA)).toEqual([
      pullRequestSurface(firstPr),
    ]);
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refA)]).toMatchObject({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
    expect(panels.getUserActionRevision(refA)).toBe(panelRevision);
  });

  it("preserves main selections and newer metadata when migrating sidebar tabs", () => {
    const mainViews = useMainViewStore.getState();
    const updated = { ...firstPr, url: "https://github.com/owner/repo/pull/1" };
    mainViews.openPullRequest(refA, updated);
    mainViews.select(refA, "review");
    useRightPanelStore.getState().openPullRequest(refA, firstPr);
    useRightPanelStore.getState().openPullRequest(refA, secondPr);
    const revision = mainViews.getUserActionRevision(refA);
    mainViews.migrateThreadPullRequests(refA);

    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("review");
    expect(selectThreadMainPullRequests(state.pullRequestsByThreadKey, refA)).toEqual([
      pullRequestSurface(updated),
      pullRequestSurface(secondPr),
    ]);
    expect(mainViews.getUserActionRevision(refA)).toBe(revision);
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refA)]).toMatchObject({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("migrates the linked list but preserves a hidden sidebar's selected Chat view", () => {
    const panels = useRightPanelStore.getState();
    panels.open(refA, "pull-requests");
    useMainViewStore.getState().migrateThreadPullRequests(refA);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-requests",
    );

    panels.open(refB, "files");
    panels.openPullRequest(refB, firstPr);
    panels.close(refB);
    useMainViewStore.getState().migrateThreadPullRequests(refB);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refB)).toBe("chat");
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refB)]).toMatchObject({
      isOpen: false,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
  });

  it("keeps the standalone PR page's shared sidebar separate", () => {
    useRightPanelStore.getState().openPullRequest(PULL_REQUESTS_PANEL_REF, firstPr);
    useMainViewStore.getState().migrateThreadPullRequests(PULL_REQUESTS_PANEL_REF);

    expect(
      selectThreadMainPullRequests(
        useMainViewStore.getState().pullRequestsByThreadKey,
        PULL_REQUESTS_PANEL_REF,
      ),
    ).toEqual([]);
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(PULL_REQUESTS_PANEL_REF)],
    ).toMatchObject({ isOpen: true, surfaces: [pullRequestSurface(firstPr)] });
  });
});
