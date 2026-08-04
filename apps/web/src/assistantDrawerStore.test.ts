import type { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectAssistantDrawerOpen, useAssistantDrawerStore } from "./assistantDrawerStore";

const environmentA = "environment-a" as EnvironmentId;
const environmentB = "environment-b" as EnvironmentId;

beforeEach(() => {
  useAssistantDrawerStore.setState({ byEnvironment: {} });
});

describe("assistantDrawerStore", () => {
  it("keeps visibility scoped to an environment", () => {
    useAssistantDrawerStore.getState().open(environmentA);

    expect(selectAssistantDrawerOpen(useAssistantDrawerStore.getState(), environmentA)).toBe(true);
    expect(selectAssistantDrawerOpen(useAssistantDrawerStore.getState(), environmentB)).toBe(false);
  });

  it("toggles and closes independently", () => {
    const store = useAssistantDrawerStore.getState();
    store.toggle(environmentA);
    store.toggle(environmentB);
    store.close(environmentA);

    expect(selectAssistantDrawerOpen(useAssistantDrawerStore.getState(), environmentA)).toBe(false);
    expect(selectAssistantDrawerOpen(useAssistantDrawerStore.getState(), environmentB)).toBe(true);
  });

  it("is closed when no environment is active", () => {
    useAssistantDrawerStore.getState().open(environmentA);
    expect(selectAssistantDrawerOpen(useAssistantDrawerStore.getState(), null)).toBe(false);
  });
});
