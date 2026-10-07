import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  DESKTOP_CORE_TABS,
  EMPTY_DESKTOP_WORKSPACE,
  desktopSurfaceId,
  desktopWorkspaceLayout,
  desktopTabForSurface,
  reconcileDesktopWorkspace,
  useDesktopWorkspaceStore,
} from "./desktopWorkspaceStore";
import type { RightPanelSurface } from "./rightPanelStore";
import { useTerminalUiStateStore } from "./terminalUiStateStore";

const ref = scopeThreadRef(EnvironmentId.make("desktop-test"), ThreadId.make("thread"));
const browser = (id: string): RightPanelSurface => ({
  id: `browser:${id}`,
  kind: "preview",
  resourceId: id,
});
const file = (path: string): RightPanelSurface => ({
  id: `file:${path}`,
  kind: "file",
  relativePath: path,
  revealLine: null,
  revealRequestId: 0,
});

describe("desktop workspace", () => {
  beforeEach(() => useDesktopWorkspaceStore.setState({ byThreadKey: {} }));
  it("migrates first browser/file into fixed slots and preserves extra resources", () => {
    const workspace = reconcileDesktopWorkspace(EMPTY_DESKTOP_WORKSPACE, [
      browser("a"),
      browser("b"),
      file("a.ts"),
      file("b.ts"),
    ]);
    expect(DESKTOP_CORE_TABS).toEqual([
      "chat",
      "review",
      "pull-request",
      "browser",
      "files",
      "agents",
    ]);
    expect(desktopSurfaceId(workspace, "browser")).toBe("browser:a");
    expect(desktopTabForSurface(workspace, "file:b.ts")).toBe("surface:file:b.ts");
    expect(workspace.surfaceOrder).toHaveLength(4);
    expect(
      reconcileDesktopWorkspace(workspace, [browser("a"), browser("b"), file("a.ts"), file("b.ts")])
        .surfaceOrder,
    ).toHaveLength(4);
  });
  it("closing fixed resource leaves launcher empty without promoting other tabs", () => {
    const first = reconcileDesktopWorkspace(EMPTY_DESKTOP_WORKSPACE, [browser("a"), browser("b")]);
    const closed = reconcileDesktopWorkspace({ ...first, selected: "browser" }, [browser("b")]);
    expect(closed.selected).toBe("browser");
    expect(closed.browserId).toBeNull();
    expect(desktopTabForSurface(closed, "browser:b")).toBe("surface:browser:b");
    expect(reconcileDesktopWorkspace(closed, [browser("b"), browser("c")]).browserId).toBe(
      "browser:c",
    );
  });
  it("remembers each tab's split, shared draft-independent visibility, and last content", () => {
    const store = useDesktopWorkspaceStore.getState();
    store.select(ref, "browser");
    store.toggleSplit(ref);
    store.setChatWidth(ref, 480);
    store.select(ref, "review");
    store.setCollapsed(ref, true);
    let workspace = useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]!;
    expect(workspace.splitTabs.review).toBeUndefined();
    expect(workspace.splitTabs.browser).toBe(true);
    store.select(ref, "chat");
    store.toggleSplit(ref);
    workspace = useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]!;
    expect(workspace.selected).toBe("review");
    expect(workspace.splitTabs.review).toBe(true);
    expect(workspace.composerCollapsed).toBe(false);
    expect(workspace.chatWidth).toBe(480);
  });
  it("restores persisted choices instead of old sidebar visibility", () => {
    const store = useDesktopWorkspaceStore.getState();
    const panel = { isOpen: true, activeSurfaceId: "browser:a", surfaces: [browser("a")] };
    store.initialize(ref, "chat", panel);
    expect(useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]?.selected).toBe(
      "browser",
    );
    store.select(ref, "agents");
    store.initialize(ref, "chat", panel);
    expect(useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]?.selected).toBe(
      "agents",
    );
  });
  it("falls back to Chat in narrow windows without losing the saved split", () => {
    const workspace = {
      ...EMPTY_DESKTOP_WORKSPACE,
      selected: "browser" as const,
      splitTabs: { browser: true },
    };
    expect(desktopWorkspaceLayout(workspace, 700)).toMatchObject({
      activeTab: "chat",
      split: false,
      floating: false,
    });
    expect(desktopWorkspaceLayout(workspace, 1000)).toMatchObject({
      activeTab: "browser",
      split: true,
      floating: false,
    });
    expect(desktopWorkspaceLayout(workspace, 1000, "chat").activeTab).toBe("chat");
    expect(workspace.selected).toBe("browser");
    expect(desktopWorkspaceLayout({ ...workspace, splitTabs: {} }, 700)).toMatchObject({
      activeTab: "browser",
      split: false,
      floating: true,
    });
  });
  it("isolates identical thread ids across environments", () => {
    const other = scopeThreadRef(EnvironmentId.make("remote"), ref.threadId);
    useDesktopWorkspaceStore.getState().select(ref, "review");
    useDesktopWorkspaceStore.getState().select(other, "browser");
    expect(useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]?.selected).toBe(
      "review",
    );
  });
  it("preserves the selected imported terminal group and keeps hidden terminals hidden", () => {
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {},
      suppressedTerminalIdsByThreadKey: {},
    });
    const store = useTerminalUiStateStore.getState();
    const groups = [
      { id: "terminal:first", terminalIds: ["one", "two"], activeTerminalId: "two" },
      { id: "terminal:last", terminalIds: ["three"], activeTerminalId: "three" },
    ];
    store.importPanelTerminals(ref, groups, { activeTerminalId: "two", open: false });
    const state =
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey[scopedThreadKey(ref)]!;
    expect(state.activeTerminalId).toBe("two");
    expect(state.activeTerminalGroupId).toBe("terminal:first");
    expect(state.terminalOpen).toBe(false);
    expect(state.terminalGroups.map((group) => group.id)).toEqual([
      "terminal:first",
      "terminal:last",
    ]);
  });
  it("imports terminal groups without replacing or duplicating session ids", () => {
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {},
      suppressedTerminalIdsByThreadKey: {},
    });
    const store = useTerminalUiStateStore.getState();
    store.ensureTerminal(ref, "drawer");
    const group = {
      terminalIds: ["panel-a", "panel-b"],
      activeTerminalId: "panel-b",
      splitDirection: "vertical" as const,
    };
    store.importPanelTerminals(ref, [group]);
    store.importPanelTerminals(ref, [group]);
    const state =
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey[scopedThreadKey(ref)]!;
    expect(state.terminalIds).toEqual(["drawer", "panel-a", "panel-b"]);
    expect(state.activeTerminalId).toBe("panel-b");
    expect(
      state.terminalGroups.find((entry) => entry.terminalIds.includes("panel-a")),
    ).toMatchObject({ terminalIds: ["panel-a", "panel-b"], splitDirection: "vertical" });
    expect(state.terminalOpen).toBe(true);
  });
});
