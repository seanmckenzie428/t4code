import { assert, describe, it, vi } from "vite-plus/test";

import {
  DESKTOP_HISTORY_BACK_ACTION,
  DESKTOP_HISTORY_FORWARD_ACTION,
  routeDesktopHistoryAction,
} from "./desktopHistoryNavigation";

function makeTargets() {
  return {
    previewBridge: {
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
    },
    appHistory: {
      back: vi.fn(),
      forward: vi.fn(),
    },
  };
}

describe("desktop history navigation", () => {
  it("routes backward and forward intents to the hovered preview", async () => {
    const targets = makeTargets();

    await routeDesktopHistoryAction({
      action: DESKTOP_HISTORY_BACK_ACTION,
      hoveredPreview: { runtimeTabId: "preview-tab" },
      ...targets,
    });
    await routeDesktopHistoryAction({
      action: DESKTOP_HISTORY_FORWARD_ACTION,
      hoveredPreview: { runtimeTabId: "preview-tab" },
      ...targets,
    });

    assert.deepEqual(targets.previewBridge.goBack.mock.calls, [["preview-tab"]]);
    assert.deepEqual(targets.previewBridge.goForward.mock.calls, [["preview-tab"]]);
    assert.equal(targets.appHistory.back.mock.calls.length, 0);
    assert.equal(targets.appHistory.forward.mock.calls.length, 0);
  });

  it("consumes preview-owned intents when the preview has no active page", async () => {
    const targets = makeTargets();

    await routeDesktopHistoryAction({
      action: DESKTOP_HISTORY_BACK_ACTION,
      hoveredPreview: { runtimeTabId: null },
      ...targets,
    });

    assert.equal(targets.previewBridge.goBack.mock.calls.length, 0);
    assert.equal(targets.appHistory.back.mock.calls.length, 0);
  });

  it("uses app history when no preview is hovered", async () => {
    const targets = makeTargets();

    await routeDesktopHistoryAction({
      action: DESKTOP_HISTORY_BACK_ACTION,
      hoveredPreview: null,
      ...targets,
    });
    await routeDesktopHistoryAction({
      action: DESKTOP_HISTORY_FORWARD_ACTION,
      hoveredPreview: null,
      ...targets,
    });

    assert.equal(targets.appHistory.back.mock.calls.length, 1);
    assert.equal(targets.appHistory.forward.mock.calls.length, 1);
    assert.equal(targets.previewBridge.goBack.mock.calls.length, 0);
    assert.equal(targets.previewBridge.goForward.mock.calls.length, 0);
  });
});
