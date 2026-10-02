import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  resolveActiveMainView,
  selectThreadMainPullRequest,
  selectThreadMainView,
  useMainViewStore,
} from "./mainViewStore";
import { PULL_REQUESTS_PANEL_REF, pullRequestSurface, useRightPanelStore } from "./rightPanelStore";

const refA = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-A"));
const refB = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-B"));
const refOtherEnvironment = scopeThreadRef(EnvironmentId.make("env-2"), refA.threadId);
const firstPr = { projectId: "project-1", repository: "owner/repo", number: 1 };
const secondPr = { ...firstPr, number: 2 };

beforeEach(() => {
  useMainViewStore.setState({
    byThreadKey: {},
    pullRequestByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("mainViewStore", () => {
  it("defaults each thread to chat", () => {
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();
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

  it("replaces the detail in one PR view and remembers it across Chat and Review", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequest(refA, secondPr);
    mainViews.select(refA, "review");
    mainViews.select(refA, "chat");
    mainViews.select(refA, "pull-request");

    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("pull-request");
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refA)).toEqual(
      pullRequestSurface(secondPr),
    );
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refB)).toBeNull();
    expect(
      selectThreadMainPullRequest(state.pullRequestByThreadKey, refOtherEnvironment),
    ).toBeNull();
  });

  it("refreshes the same PR reference when opened with newer metadata", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    const updated = { ...firstPr, url: "https://github.com/owner/repo/pull/1" };
    mainViews.openPullRequest(refA, updated);

    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(updated));
  });

  it("shows the linked list and selected detail inside the same PR view", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequests(refA);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();

    mainViews.select(refA, "chat");
    mainViews.select(refA, "pull-request");
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();
    mainViews.openPullRequest(refA, secondPr);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(secondPr));
  });

  it("protects explicit PR opens and view changes from stale proactive selections", () => {
    const mainViews = useMainViewStore.getState();
    const revisionAtTurnStart = mainViews.getUserActionRevision(refA);
    mainViews.openPullRequest(refA, firstPr);
    expect(mainViews.selectProactive(refA, "review", revisionAtTurnStart)).toBe(false);
    expect(mainViews.openPullRequest(refA, secondPr, revisionAtTurnStart)).toBe(false);
    expect(mainViews.openPullRequests(refA, revisionAtTurnStart)).toBe(false);
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(firstPr));

    const revisionAfterOpen = mainViews.getUserActionRevision(refA);
    mainViews.select(refA, "chat");
    expect(mainViews.openPullRequest(refA, secondPr, revisionAfterOpen)).toBe(false);
    expect(mainViews.openPullRequests(refA, revisionAfterOpen)).toBe(false);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("opens proactive PR views without advancing user intent", () => {
    const mainViews = useMainViewStore.getState();
    const revision = mainViews.getUserActionRevision(refA);
    expect(mainViews.openPullRequest(refA, firstPr, revision)).toBe(true);
    expect(mainViews.openPullRequests(refA, revision)).toBe(true);
    expect(mainViews.getUserActionRevision(refA)).toBe(revision);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();

    mainViews.openPullRequests(refA);
    expect(mainViews.selectProactive(refA, "review", revision)).toBe(false);
  });

  it("restores the persisted PR view without session-only intent revisions", async () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequests(refB);
    const options = useMainViewStore.persist.getOptions();
    if (!options.name || !options.storage) throw new Error("Persistence is not configured");
    const persisted = await options.storage.getItem(options.name);
    if (!persisted) throw new Error("PR view was not persisted");
    expect(persisted).toEqual({
      version: 2,
      state: {
        byThreadKey: {
          [scopedThreadKey(refA)]: "pull-request",
          [scopedThreadKey(refB)]: "pull-request",
        },
        pullRequestByThreadKey: {
          [scopedThreadKey(refA)]: pullRequestSurface(firstPr),
          [scopedThreadKey(refB)]: null,
        },
      },
    });
    useMainViewStore.setState({
      byThreadKey: {},
      pullRequestByThreadKey: {},
      userActionRevisionByThreadKey: {},
    });
    await options.storage.setItem(options.name, persisted);
    await useMainViewStore.persist.rehydrate();

    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(firstPr));
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refB),
    ).toBeNull();
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refB)).toBe(
      "pull-request",
    );
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
  });

  it("collapses saved PR tabs to the selected detail, or last detail while Chat or Review is selected", async () => {
    const migrate = useMainViewStore.persist.getOptions().migrate;
    if (!migrate) throw new Error("Persistence migration is not configured");
    const surfaces = [pullRequestSurface(firstPr), pullRequestSurface(secondPr)];
    expect(
      await migrate(
        {
          byThreadKey: { selected: surfaces[0]!.id, chat: "chat", review: "review" },
          pullRequestsByThreadKey: { selected: surfaces, chat: surfaces, review: surfaces },
        },
        1,
      ),
    ).toEqual({
      byThreadKey: { selected: "pull-request", chat: "chat", review: "review" },
      pullRequestByThreadKey: { selected: surfaces[0], chat: surfaces[1], review: surfaces[1] },
    });
  });

  it("preserves the saved linked list instead of reviving a previously opened detail", async () => {
    const migrate = useMainViewStore.persist.getOptions().migrate;
    if (!migrate) throw new Error("Persistence migration is not configured");
    expect(
      await migrate(
        {
          byThreadKey: { list: "pull-requests", chat: "chat" },
          pullRequestsByThreadKey: { list: [pullRequestSurface(firstPr)] },
        },
        1,
      ),
    ).toEqual({
      byThreadKey: { list: "pull-request", chat: "chat" },
      pullRequestByThreadKey: { list: null },
    });
    expect(await migrate({ byThreadKey: { review: "review" } }, 0)).toEqual({
      byThreadKey: { review: "review" },
      pullRequestByThreadKey: {},
    });
  });

  it("removes only the deleted thread's remembered PR and selection", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequest(refA, firstPr);
    mainViews.openPullRequest(refB, secondPr);
    mainViews.removeThread(refA);

    const state = useMainViewStore.getState();
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refA)).toBeNull();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("chat");
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refB)).toEqual(
      pullRequestSurface(secondPr),
    );
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
  });

  it("falls back to Chat when Review or both PR contents are unavailable", () => {
    const surface = pullRequestSurface(firstPr);
    expect(resolveActiveMainView("review", false)).toBe("chat");
    expect(resolveActiveMainView("review", true)).toBe("review");
    expect(resolveActiveMainView("pull-request", true)).toBe("chat");
    expect(resolveActiveMainView("pull-request", true, surface)).toBe("pull-request");
    expect(resolveActiveMainView("pull-request", true, null, true)).toBe("pull-request");
  });

  it("migrates the active sidebar PR into one main view without dismissing other panels", () => {
    const panels = useRightPanelStore.getState();
    panels.open(refA, "files");
    panels.openPullRequest(refA, firstPr);
    panels.openPullRequest(refA, secondPr);
    panels.openPullRequest(refA, firstPr);
    const panelRevision = panels.getUserActionRevision(refA);
    const mainViews = useMainViewStore.getState();
    mainViews.migrateThreadPullRequests(refA);
    mainViews.migrateThreadPullRequests(refA);

    const state = useMainViewStore.getState();
    expect(selectThreadMainView(state.byThreadKey, refA)).toBe("pull-request");
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refA)).toEqual(
      pullRequestSurface(firstPr),
    );
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refA)]).toMatchObject({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
    expect(mainViews.getUserActionRevision(refA)).toBe(0);
    expect(panels.getUserActionRevision(refA)).toBe(panelRevision);
  });

  it("preserves explicit main selection and newer metadata when migrating sidebar tabs", () => {
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
    expect(selectThreadMainPullRequest(state.pullRequestByThreadKey, refA)).toEqual(
      pullRequestSurface(updated),
    );
    expect(mainViews.getUserActionRevision(refA)).toBe(revision);
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refA)]).toMatchObject({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("keeps an explicitly selected Chat view when migrating an open sidebar PR", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.select(refA, "chat");
    useRightPanelStore.getState().openPullRequest(refA, firstPr);
    mainViews.migrateThreadPullRequests(refA);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(firstPr));
  });

  it("keeps the main linked list selected when stale sidebar detail exists", () => {
    const mainViews = useMainViewStore.getState();
    mainViews.openPullRequests(refA);
    useRightPanelStore.getState().openPullRequest(refA, firstPr);
    mainViews.migrateThreadPullRequests(refA);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();
  });

  it("migrates the linked list but preserves a hidden sidebar's selected Chat view", () => {
    const panels = useRightPanelStore.getState();
    panels.openPullRequest(refA, firstPr);
    panels.open(refA, "pull-requests");
    useMainViewStore.getState().migrateThreadPullRequests(refA);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe(
      "pull-request",
    );
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toBeNull();

    panels.open(refB, "files");
    panels.openPullRequest(refB, firstPr);
    panels.close(refB);
    useMainViewStore.getState().migrateThreadPullRequests(refB);
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refB)).toBe("chat");
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refB),
    ).toEqual(pullRequestSurface(firstPr));
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refB)]).toMatchObject({
      isOpen: false,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
  });

  it("remembers the last sidebar PR when a non-PR panel is selected", () => {
    const panels = useRightPanelStore.getState();
    panels.openPullRequest(refA, firstPr);
    panels.openPullRequest(refA, secondPr);
    panels.open(refA, "files");
    useMainViewStore.getState().migrateThreadPullRequests(refA);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
    expect(
      selectThreadMainPullRequest(useMainViewStore.getState().pullRequestByThreadKey, refA),
    ).toEqual(pullRequestSurface(secondPr));
  });

  it("keeps the standalone PR page's shared sidebar separate", () => {
    useRightPanelStore.getState().openPullRequest(PULL_REQUESTS_PANEL_REF, firstPr);
    useMainViewStore.getState().migrateThreadPullRequests(PULL_REQUESTS_PANEL_REF);

    expect(
      selectThreadMainPullRequest(
        useMainViewStore.getState().pullRequestByThreadKey,
        PULL_REQUESTS_PANEL_REF,
      ),
    ).toBeNull();
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(PULL_REQUESTS_PANEL_REF)],
    ).toMatchObject({ isOpen: true, surfaces: [pullRequestSurface(firstPr)] });
  });
});
