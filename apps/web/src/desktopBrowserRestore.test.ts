import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { reconcileDesktopBrowsers } from "./desktopBrowserRestore";
import { useDesktopWorkspaceStore } from "./desktopWorkspaceStore";
import { useRightPanelStore } from "./rightPanelStore";
import { connectDesktopWorkspace } from "./hooks/useDesktopWorkspace";
import {
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "./previewStateStore";

const ref = { environmentId: EnvironmentId.make("restore"), threadId: ThreadId.make("thread") };
const key = scopedThreadKey(ref);
const snapshot = (tabId: string): PreviewSessionSnapshot => ({
  threadId: ref.threadId,
  tabId,
  navStatus: { _tag: "Loading", url: "http://localhost:3000/", title: "App" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-07T00:00:00.000Z",
});
let disconnect: () => void;
beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useDesktopWorkspaceStore.setState({ byThreadKey: {} });
  disconnect = connectDesktopWorkspace(ref);
  useRightPanelStore.getState().openBrowser(ref, "old");
  useDesktopWorkspaceStore
    .getState()
    .rememberBrowser(ref, "browser:old", "before", snapshot("old"));
});
afterEach(() => disconnect());
const list = (epoch: string, sessions: PreviewSessionSnapshot[] = []) => {
  reconcilePreviewServerSessions(ref, { serverEpoch: epoch, revision: 1, sessions });
  return readThreadPreviewState(ref);
};
const panel = () => useRightPanelStore.getState().byThreadKey[key]!;

it("retains persisted tabs until an authoritative list arrives", async () => {
  const open = vi.fn();
  await reconcileDesktopBrowsers(ref, readThreadPreviewState(ref), open, vi.fn(), vi.fn());
  expect(panel().surfaces).toHaveLength(1);
  expect(open).not.toHaveBeenCalled();
});
it("reuses surviving sessions on renderer reload", async () => {
  const open = vi.fn();
  await reconcileDesktopBrowsers(ref, list("before", [snapshot("old")]), open, vi.fn(), vi.fn());
  expect(open).not.toHaveBeenCalled();
  expect(panel().surfaces[0]).toMatchObject({ resourceId: "old" });
});
it("restores after backend restart without changing tab order, selection, or split", async () => {
  useDesktopWorkspaceStore.getState().toggleSplit(ref);
  const before = useDesktopWorkspaceStore.getState().byThreadKey[key]!;
  const open = vi.fn(async () => snapshot("new"));
  await reconcileDesktopBrowsers(ref, list("after"), open, vi.fn(), vi.fn());
  expect(open).toHaveBeenCalledWith(snapshot("old"));
  expect(panel().surfaces[0]).toEqual({ id: "browser:old", kind: "preview", resourceId: "new" });
  expect(useDesktopWorkspaceStore.getState().byThreadKey[key]).toMatchObject({
    selected: before.selected,
    surfaceOrder: before.surfaceOrder,
    splitTabs: before.splitTabs,
  });
  await reconcileDesktopBrowsers(ref, readThreadPreviewState(ref), open, vi.fn(), vi.fn());
  useRightPanelStore.getState().openBrowser(ref, "new");
  expect(panel().surfaces).toHaveLength(1);
  expect(useDesktopWorkspaceStore.getState().byThreadKey[key]?.selected).toBe("browser");
});
it("does not resurrect intentionally closed tabs in the same server epoch", async () => {
  const open = vi.fn();
  await reconcileDesktopBrowsers(ref, list("before"), open, vi.fn(), vi.fn());
  expect(open).not.toHaveBeenCalled();
  expect(panel()?.surfaces ?? []).toEqual([]);
});
it("coalesces restoration and closes the new session if its tab was closed meanwhile", async () => {
  let resolve!: (value: PreviewSessionSnapshot) => void;
  const open = vi.fn(
    () =>
      new Promise<PreviewSessionSnapshot>((done) => {
        resolve = done;
      }),
  );
  const close = vi.fn(async () => undefined);
  const state = list("after");
  const first = reconcileDesktopBrowsers(ref, state, open, close, vi.fn());
  const second = reconcileDesktopBrowsers(ref, state, open, close, vi.fn());
  useRightPanelStore.getState().closeSurface(ref, "browser:old");
  resolve(snapshot("new"));
  await Promise.all([first, second]);
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith("new");
  expect(panel()?.surfaces ?? []).toEqual([]);
});
it("reports restoration failures and leaves a usable fixed launcher", async () => {
  const onFailure = vi.fn();
  await reconcileDesktopBrowsers(
    ref,
    list("after"),
    async () => {
      throw new Error("offline");
    },
    vi.fn(),
    onFailure,
  );
  expect(onFailure).toHaveBeenCalledOnce();
  expect(useDesktopWorkspaceStore.getState().byThreadKey[key]?.browserId).toBeNull();
});

it.each(["open", "cleanup"])(
  "ignores obsolete %s failures after a newer epoch restores",
  async (failure) => {
    let resolve!: (snapshot: PreviewSessionSnapshot) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<PreviewSessionSnapshot>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const onFailure = vi.fn();
    const oldRestore = reconcileDesktopBrowsers(
      ref,
      list("second"),
      () => pending,
      async () => {
        throw new Error("old server gone");
      },
      onFailure,
    );
    await reconcileDesktopBrowsers(
      ref,
      list("third"),
      async () => snapshot("current"),
      vi.fn(),
      onFailure,
    );
    if (failure === "open") reject(new Error("old server gone"));
    else resolve(snapshot("obsolete"));
    await oldRestore;
    expect(panel().surfaces).toEqual([
      { id: "browser:old", kind: "preview", resourceId: "current" },
    ]);
    expect(
      useDesktopWorkspaceStore.getState().byThreadKey[key]?.browserSessions?.["browser:old"],
    ).toMatchObject({ epoch: "third", snapshot: { tabId: "current" } });
    expect(onFailure).not.toHaveBeenCalled();
  },
);
