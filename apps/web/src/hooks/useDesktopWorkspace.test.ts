import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { connectDesktopWorkspace } from "./useDesktopWorkspace";
import { useDesktopWorkspaceStore } from "../desktopWorkspaceStore";
import { useRightPanelStore } from "../rightPanelStore";
import { useMainViewStore } from "../mainViewStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

const ref = scopeThreadRef(EnvironmentId.make("desktop-test"), ThreadId.make("thread"));
const key = scopedThreadKey(ref);
const workspace = () => useDesktopWorkspaceStore.getState().byThreadKey[key]!;
let disconnect: (() => void) | undefined;
beforeEach(() => {
  useDesktopWorkspaceStore.setState({ byThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useMainViewStore.setState({
    byThreadKey: {},
    pullRequestByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
});
afterEach(() => {
  disconnect?.();
  disconnect = undefined;
});

describe("desktop resource routing", () => {
  it("opens fixed and additional tabs and reselects existing resources from Chat", () => {
    disconnect = connectDesktopWorkspace(ref);
    const panel = useRightPanelStore.getState();
    panel.openBrowser(ref, "a");
    expect(workspace().selected).toBe("browser");
    panel.openBrowser(ref, "b");
    expect(workspace().selected).toBe("surface:browser:b");
    panel.openFile(ref, "src/a.ts", 12);
    expect(workspace().selected).toBe("files");
    panel.openFile(ref, "src/b.ts");
    expect(workspace().selected).toBe("surface:file:src/b.ts");
    useMainViewStore.getState().select(ref, "chat");
    panel.openFile(ref, "src/b.ts", 24);
    expect(workspace().selected).toBe("surface:file:src/b.ts");
    expect(workspace().surfaceOrder).toHaveLength(4);
    useDesktopWorkspaceStore.getState().reorder(ref, "file:src/b.ts", "browser:b");
    expect(workspace().surfaceOrder).toEqual([
      "browser:a",
      "file:src/b.ts",
      "browser:b",
      "file:src/a.ts",
    ]);
    panel.closeSurface(ref, "file:src/a.ts");
    expect(workspace().fileId).toBeNull();
    panel.openFile(ref, "src/a.ts");
    expect(workspace().selected).toBe("files");
  });
  it("preserves explicit PR selection and rejects delayed discovery after opening content", () => {
    disconnect = connectDesktopWorkspace(ref);
    const main = useMainViewStore.getState();
    main.openPullRequest(ref, { projectId: "project", repository: "owner/repo", number: 1 });
    expect(workspace().selected).toBe("pull-request");
    const before = main.getUserActionRevision(ref);
    useRightPanelStore.getState().openBrowser(ref, "a");
    expect(main.selectProactive(ref, "pull-request", before)).toBe(false);
    expect(workspace().selected).toBe("browser");
    main.select(ref, "pull-request");
    expect(workspace().selected).toBe("pull-request");
  });
  it("moves existing terminal ownership without losing sessions or active split group", () => {
    const panel = useRightPanelStore.getState();
    panel.openTerminal(ref, "one");
    panel.splitTerminal(ref, "terminal:one", "two", "vertical");
    panel.openTerminal(ref, "three");
    panel.activateSurface(ref, "terminal:one");
    disconnect = connectDesktopWorkspace(ref);
    const terminal = useTerminalUiStateStore.getState().terminalUiStateByThreadKey[key]!;
    expect(terminal.terminalIds).toEqual(["one", "two", "three"]);
    expect(terminal.activeTerminalId).toBe("two");
    expect(terminal.activeTerminalGroupId).toBe("terminal:one");
    expect(terminal.terminalGroups[0]).toMatchObject({
      terminalIds: ["one", "two"],
      splitDirection: "vertical",
    });
    expect(useRightPanelStore.getState().byThreadKey[key]?.surfaces).toEqual([]);
    disconnect();
    disconnect = connectDesktopWorkspace(ref);
    expect(useTerminalUiStateStore.getState().terminalUiStateByThreadKey[key]).toBe(terminal);
    panel.openTerminal(ref, "four");
    expect(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey[key]?.activeTerminalId,
    ).toBe("four");
  });
  it("does not leave Chat or Review when an inactive resource closes", () => {
    disconnect = connectDesktopWorkspace(ref);
    const panel = useRightPanelStore.getState();
    panel.openBrowser(ref, "a");
    panel.openBrowser(ref, "b");
    useMainViewStore.getState().select(ref, "review");
    panel.closeSurface(ref, "browser:a");
    expect(workspace().selected).toBe("review");
    useMainViewStore.getState().select(ref, "chat");
    panel.closeSurface(ref, "browser:b");
    expect(workspace().selected).toBe("chat");
  });
  it("stops synchronizing when leaving the thread", () => {
    disconnect = connectDesktopWorkspace(ref);
    disconnect();
    disconnect = undefined;
    useRightPanelStore.getState().openBrowser(ref, "a");
    expect(workspace().selected).toBe("chat");
  });
});
