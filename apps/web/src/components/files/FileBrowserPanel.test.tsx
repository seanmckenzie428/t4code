// @vitest-environment jsdom
import type { FileTree as FileTreeModel } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import FileBrowserPanel from "./FileBrowserPanel";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { connectDesktopWorkspace } from "~/hooks/useDesktopWorkspace";
import { desktopSurfaceId, useDesktopWorkspaceStore } from "~/desktopWorkspaceStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useMainViewStore } from "~/mainViewStore";

const directory = vi.hoisted(() => ({
  entries: [
    { path: "package.json", kind: "file" },
    { path: "README.md", kind: "file" },
  ],
  load: vi.fn(async () => {}),
  refresh: vi.fn(),
  ready: true,
  error: null,
  isPending: false,
}));
const search = vi.hoisted(() => ({ entries: [], isPending: false, refresh: vi.fn() }));
vi.mock("./useDirectoryEntries", () => ({ useDirectoryEntries: () => directory }));
vi.mock("~/state/queries", () => ({ useProjectPathSearch: () => search }));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: vi.fn() }));
vi.mock("~/composerHandleContext", () => ({ useComposerHandleContext: () => null }));
vi.mock("~/fileContextMenu", () => ({ useFileContextMenu: () => ({}) }));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
let renderer: ReactTestRenderer | undefined;
const model = (): FileTreeModel => renderer!.root.findByType(FileTree).props.model;
const props = {
  environmentId: EnvironmentId.make("files-test"),
  cwd: "/workspace",
  projectName: "Project",
  selectedPath: null,
  selectedPathRevealId: 0,
  workspaceMutationId: null,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it("opens files using the current callback after the workspace changes", async () => {
  const oldOpen = vi.fn();
  const currentOpen = vi.fn();
  await act(async () => {
    renderer = create(<FileBrowserPanel {...props} onOpenFile={oldOpen} />);
  });
  await act(async () => {
    renderer!.update(<FileBrowserPanel {...props} onOpenFile={currentOpen} />);
  });
  await act(async () => {
    model().getItem("package.json")!.select();
  });
  expect(currentOpen).toHaveBeenCalledWith("package.json");
  expect(oldOpen).not.toHaveBeenCalled();
});

it("routes selections to the current main workspace and keeps opening after reveal sync", async () => {
  useDesktopWorkspaceStore.setState({ byThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useMainViewStore.setState({
    byThreadKey: {},
    pullRequestByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  const first = scopeThreadRef(props.environmentId, ThreadId.make("first"));
  const second = scopeThreadRef(props.environmentId, ThreadId.make("second"));
  const disconnectFirst = connectDesktopWorkspace(first);
  const disconnectSecond = connectDesktopWorkspace(second);
  const panel = (ref: typeof first, selectedPath: string | null = null) => (
    <FileBrowserPanel
      {...props}
      selectedPath={selectedPath}
      onOpenFile={(path) => useRightPanelStore.getState().openFile(ref, path)}
    />
  );
  try {
    await act(async () => {
      renderer = create(panel(first));
    });
    await act(async () => {
      renderer!.update(panel(second));
    });
    await act(async () => {
      model().getItem("package.json")!.select();
    });
    const workspace = () =>
      useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(second)]!;
    const surface = () =>
      useRightPanelStore
        .getState()
        .byThreadKey[scopedThreadKey(second)]?.surfaces.find(
          (surface) => surface.id === desktopSurfaceId(workspace()),
        );
    expect(workspace().selected).toBe("files");
    expect(surface()).toMatchObject({ kind: "file", relativePath: "package.json" });
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(first)]).toBeUndefined();
    await act(async () => {
      renderer!.update(panel(second, "package.json"));
    });
    await act(async () => {
      model().getItem("package.json")!.deselect();
      model().getItem("README.md")!.select();
    });
    expect(surface()).toMatchObject({ kind: "file", relativePath: "README.md" });
  } finally {
    disconnectFirst();
    disconnectSecond();
  }
});
