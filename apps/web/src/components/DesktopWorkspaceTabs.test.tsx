// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DesktopWorkspaceTabs } from "./DesktopWorkspaceTabs";
import { EMPTY_DESKTOP_WORKSPACE } from "../desktopWorkspaceStore";

let root: Root;
let container: HTMLDivElement;
let resize: (() => void) | undefined;
let availableWidth = 900;
const tabsWidth = 600;
beforeEach(() => {
  availableWidth = 900;
  resize = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => availableWidth);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => tabsWidth);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows the tab picker only while tabs overflow", async () => {
  await act(async () =>
    root.render(
      <DesktopWorkspaceTabs
        workspace={EMPTY_DESKTOP_WORKSPACE}
        surfaces={[]}
        reviewAvailable
        prAvailable
        surfaceTitle={() => "Content"}
        split={false}
        splitShortcut={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onSplit={vi.fn()}
        onNewBrowser={vi.fn()}
        onFiles={vi.fn()}
        onViews={vi.fn()}
        onDevice={vi.fn()}
      />,
    ),
  );
  const picker = () => container.querySelector('[aria-label="Open tab picker"]');
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(6);
  expect(picker()).toBeNull();
  availableWidth = 400;
  await act(async () => resize?.());
  expect(picker()).not.toBeNull();
  availableWidth = 900;
  await act(async () => resize?.());
  expect(picker()).toBeNull();
});
