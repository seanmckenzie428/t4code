import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { connectDesktopWorkspace } from "./useDesktopWorkspace";
import { useDesktopWorkspaceStore } from "../desktopWorkspaceStore";
import { useRightPanelStore } from "../rightPanelStore";
import { useMainViewStore } from "../mainViewStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

import { AsyncResult } from "effect/unstable/reactivity";
import { addBrowserSurface } from "../components/preview/addBrowserSurface";
import { __setClientSettingsForTests } from "./useSettings";
import { readThreadPreviewState, resetPreviewStateForTests } from "../previewStateStore";
import { desktopSurfaceId } from "../desktopWorkspaceStore";

const ref = scopeThreadRef(EnvironmentId.make("desktop-test"), ThreadId.make("thread"));
const key = scopedThreadKey(ref);
const workspace = () => useDesktopWorkspaceStore.getState().byThreadKey[key]!;
let disconnect: (() => void) | undefined;
beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
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
  it("opens the browser from an empty fixed launcher using the real creation path", async () => {
    disconnect = connectDesktopWorkspace(ref);
    useDesktopWorkspaceStore.getState().select(ref, "browser");
    const result = await addBrowserSurface({
      threadRef: ref,
      openPreview: async () =>
        AsyncResult.success({
          threadId: ref.threadId,
          tabId: "new-tab",
          navStatus: { _tag: "Idle" },
          canGoBack: false,
          canGoForward: false,
          updatedAt: "2026-10-07T00:00:00.000Z",
        }),
    });
    expect(result._tag).toBe("Success");
    expect(readThreadPreviewState(ref).sessions["new-tab"]).toBeDefined();
    expect(workspace().selected).toBe("browser");
    const id = desktopSurfaceId(workspace());
    expect(
      useRightPanelStore.getState().byThreadKey[key]?.surfaces.find((surface) => surface.id === id),
    ).toMatchObject({ kind: "preview", resourceId: "new-tab" });
  });
  it("opens file content from the fixed Files launcher", () => {
    disconnect = connectDesktopWorkspace(ref);
    useDesktopWorkspaceStore.getState().select(ref, "files");
    useRightPanelStore.getState().openFile(ref, "package.json");
    expect(workspace().selected).toBe("files");
    const id = desktopSurfaceId(workspace());
    expect(
      useRightPanelStore.getState().byThreadKey[key]?.surfaces.find((surface) => surface.id === id),
    ).toMatchObject({ kind: "file", relativePath: "package.json" });
  });
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
