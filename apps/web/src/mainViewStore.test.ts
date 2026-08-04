import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActiveMainView, selectThreadMainView, useMainViewStore } from "./mainViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => useMainViewStore.setState({ byThreadKey: {} }));

describe("mainViewStore", () => {
  it("defaults each thread to chat", () => {
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("keeps the selected view scoped to its thread", () => {
    useMainViewStore.getState().select(refA, "review");

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("review");
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refB)).toBe("chat");
  });

  it("removes saved state with the thread", () => {
    useMainViewStore.getState().select(refA, "review");
    useMainViewStore.getState().removeThread(refA);

    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, refA)).toBe("chat");
  });

  it("falls back to chat when review is unavailable", () => {
    expect(resolveActiveMainView("review", false)).toBe("chat");
    expect(resolveActiveMainView("review", true)).toBe("review");
  });
});
