import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  desktopWorkspaceLayout,
  EMPTY_DESKTOP_WORKSPACE,
  useDesktopWorkspaceStore,
} from "../desktopWorkspaceStore";
import { useDesktopReplyDismissal } from "./useDesktopReplyDismissal";

const ref = { environmentId: EnvironmentId.make("reply"), threadId: ThreadId.make("one") };
const other = { ...ref, threadId: ThreadId.make("two") };
let renderer: ReactTestRenderer | undefined;
function Probe({ thread = ref, sending = false }) {
  const workspace = useDesktopWorkspaceStore(
    (state) => state.byThreadKey[scopedThreadKey(thread)] ?? EMPTY_DESKTOP_WORKSPACE,
  );
  useDesktopReplyDismissal(
    thread,
    workspace.dismissedReplyId ? null : "answer",
    desktopWorkspaceLayout(workspace, 1000),
    sending,
  );
  return null;
}
const state = () => useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useDesktopWorkspaceStore.setState({
    byThreadKey: {
      [scopedThreadKey(ref)]: {
        ...EMPTY_DESKTOP_WORKSPACE,
        selected: "browser",
        splitTabs: { files: true },
      },
      [scopedThreadKey(other)]: {
        ...EMPTY_DESKTOP_WORKSPACE,
        selected: "files",
        splitTabs: { files: true },
      },
    },
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it("preserves the reply across content tabs, remembered splits, and thread switches", async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "files"));
  expect(desktopWorkspaceLayout(state(), 1000).split).toBe(true);
  expect(state().dismissedReplyId).toBeNull();
  await act(async () => renderer!.update(<Probe thread={other} />));
  await act(async () => renderer!.update(<Probe />));
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "browser"));
  expect(state().dismissedReplyId).toBeNull();
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "chat"));
  expect(state().dismissedReplyId).toBe("answer");
});
it("dismisses when sending the next message from floating Chat", async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  await act(async () => renderer!.update(<Probe sending />));
  expect(state().dismissedReplyId).toBe("answer");
});
