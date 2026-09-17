import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActiveMainView, selectThreadMainView, useMainViewStore } from "./mainViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => useMainViewStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} }));

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
});
