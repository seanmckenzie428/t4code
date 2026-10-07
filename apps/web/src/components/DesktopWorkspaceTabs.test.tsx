// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DesktopWorkspaceTabs, desktopTabIds } from "./DesktopWorkspaceTabs";
import { EMPTY_DESKTOP_WORKSPACE, useDesktopWorkspaceStore } from "../desktopWorkspaceStore";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { RightPanelSurface } from "../rightPanelStore";

let root: Root;
let container: HTMLDivElement;
let resize: (() => void) | undefined;
let availableWidth = 900;
const tabsWidth = 600;
beforeEach(() => {
  availableWidth = 900;
  resize = undefined;
  useDesktopWorkspaceStore.setState({ byThreadKey: {} });
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

it("drags core and resource tabs, restores their order, and retains an empty Browser launcher", async () => {
  const ref = { environmentId: EnvironmentId.make("tab-drag"), threadId: ThreadId.make("thread") };
  const key = scopedThreadKey(ref);
  const initialSurfaces: RightPanelSurface[] = [
    { id: "browser:first", kind: "preview", resourceId: "first" },
    { id: "browser:extra", kind: "preview", resourceId: "extra" },
  ];
  useDesktopWorkspaceStore.getState().initialize(ref, "chat", {
    isOpen: false,
    activeSurfaceId: null,
    surfaces: initialSurfaces,
  });
  function Workspace() {
    const workspace = useDesktopWorkspaceStore(
      (state) => state.byThreadKey[key] ?? EMPTY_DESKTOP_WORKSPACE,
    );
    const [surfaces, setSurfaces] = useState(initialSurfaces);
    return (
      <DesktopWorkspaceTabs
        workspace={workspace}
        surfaces={surfaces}
        reviewAvailable
        prAvailable={false}
        surfaceTitle={() => "Extra browser"}
        split={false}
        splitShortcut={null}
        onSelect={(tab) => useDesktopWorkspaceStore.getState().select(ref, tab)}
        onClose={(surface) => {
          const remaining = surfaces.filter((entry) => entry.id !== surface.id);
          setSurfaces(remaining);
          useDesktopWorkspaceStore.getState().syncPanel(
            ref,
            {
              isOpen: true,
              activeSurfaceId: null,
              surfaces: remaining,
            },
            false,
          );
        }}
        onReorder={(from, to) => useDesktopWorkspaceStore.getState().reorder(ref, from, to)}
        onSplit={vi.fn()}
        onNewBrowser={vi.fn()}
        onFiles={vi.fn()}
        onViews={vi.fn()}
        onDevice={vi.fn()}
      />
    );
  }
  await act(async () => root.render(<Workspace />));
  const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const labels = () => tabs().map((tab) => tab.textContent);
  const drag = async (from: string, to: string) => {
    const source = tabs()
      .find((tab) => tab.textContent === from)!
      .closest('[draggable="true"]')!;
    const target = tabs()
      .find((tab) => tab.textContent === to)!
      .closest('[draggable="true"]')!;
    const start = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "dataTransfer", {
      value: { setData: vi.fn(), effectAllowed: "" },
    });
    await act(async () => {
      source.dispatchEvent(start);
      target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
  };
  expect(labels()).toEqual([
    "Chat",
    "Browser",
    "Review",
    "PR",
    "Files",
    "Subagents",
    "Extra browser",
  ]);
  await drag("Browser", "Files");
  await drag("Extra browser", "Chat");
  await drag("Chat", "PR");
  const expected = ["Extra browser", "Review", "PR", "Chat", "Files", "Browser", "Subagents"];
  expect(labels()).toEqual(expected);
  expect(desktopTabIds(useDesktopWorkspaceStore.getState().byThreadKey[key]!, true, false)).toEqual(
    ["surface:browser:extra", "review", "chat", "files", "browser", "agents"],
  );
  expect(tabs().find((tab) => tab.textContent === "PR")?.disabled).toBe(true);
  const saved = localStorage.getItem("pilot:desktop-workspace:v1")!;
  await act(async () => {
    useDesktopWorkspaceStore.setState({ byThreadKey: {} });
    localStorage.setItem("pilot:desktop-workspace:v1", saved);
    await useDesktopWorkspaceStore.persist.rehydrate();
  });
  expect(labels()).toEqual(expected);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close Browser"]')!.click(),
  );
  expect(labels()).toEqual(expected);
  expect(useDesktopWorkspaceStore.getState().byThreadKey[key]?.browserId).toBeNull();
  expect(container.querySelector('[aria-label="Close Browser"]')).toBeNull();
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
