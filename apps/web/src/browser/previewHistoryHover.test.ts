import { afterEach, assert, describe, it } from "vite-plus/test";

import {
  claimPreviewHistoryHover,
  readPreviewHistoryHover,
  releasePreviewHistoryHover,
} from "./previewHistoryHover";

const owners = new Set<object>();

function owner(): object {
  const value = {};
  owners.add(value);
  return value;
}

afterEach(() => {
  for (const value of owners) releasePreviewHistoryHover(value);
  owners.clear();
});

describe("preview history hover", () => {
  it("tracks the most recently entered preview and restores its parent owner", () => {
    const panel = owner();
    const webview = owner();

    claimPreviewHistoryHover(panel, { runtimeTabId: "panel-tab" });
    claimPreviewHistoryHover(webview, { runtimeTabId: "webview-tab" });
    assert.deepEqual(readPreviewHistoryHover(), { runtimeTabId: "webview-tab" });

    releasePreviewHistoryHover(webview);
    assert.deepEqual(readPreviewHistoryHover(), { runtimeTabId: "panel-tab" });

    releasePreviewHistoryHover(panel);
    assert.isNull(readPreviewHistoryHover());
  });

  it("keeps an empty preview as a history-owning no-op target", () => {
    const panel = owner();
    claimPreviewHistoryHover(panel, { runtimeTabId: null });

    assert.deepEqual(readPreviewHistoryHover(), { runtimeTabId: null });
  });
});
