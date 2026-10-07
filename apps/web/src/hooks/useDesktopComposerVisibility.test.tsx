import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore, type ComposerThreadTarget } from "../composerDraftStore";
import { EMPTY_DESKTOP_WORKSPACE, useDesktopWorkspaceStore } from "../desktopWorkspaceStore";
import { buildFileReviewComment } from "../reviewCommentContext";
import {
  toggleDesktopComposer,
  useDesktopComposerVisibility,
} from "./useDesktopComposerVisibility";

const ref = { environmentId: EnvironmentId.make("desktop"), threadId: ThreadId.make("one") };
let renderer: ReactTestRenderer | undefined;
function Probe({
  target = ref,
  desktop = true,
  retainedAttachments = false,
}: {
  target?: ComposerThreadTarget;
  desktop?: boolean;
  retainedAttachments?: boolean;
}) {
  const workspace = useDesktopWorkspaceStore(
    (state) => state.byThreadKey[scopedThreadKey(ref)] ?? EMPTY_DESKTOP_WORKSPACE,
  );
  useDesktopComposerVisibility(
    desktop ? { ...ref } : null,
    workspace.selected,
    target,
    retainedAttachments,
  );
  return null;
}
const workspace = () => useDesktopWorkspaceStore.getState().byThreadKey[scopedThreadKey(ref)]!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  useDesktopWorkspaceStore.setState({
    byThreadKey: {
      [scopedThreadKey(ref)]: { ...EMPTY_DESKTOP_WORKSPACE, composerCollapsed: false },
    },
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it("collapses an empty composer on content entry and lets repeated toggles show and hide it", async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "browser"));
  expect(workspace().composerCollapsed).toBe(true);
  await act(async () => {
    expect(toggleDesktopComposer(ref, "browser")).toBe("composer");
  });
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => {
    expect(toggleDesktopComposer(ref, "browser")).toBe("content");
  });
  expect(workspace().composerCollapsed).toBe(true);
  useComposerDraftStore.getState().setPrompt(ref, "Unsent message");
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "chat"));
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "browser"));
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => {
    toggleDesktopComposer(ref, "browser");
  });
  await act(async () => renderer!.update(<Probe target={{ ...ref }} />));
  expect(workspace().composerCollapsed).toBe(true);
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe("Unsent message");
});
it("keeps pending attachments visible on entry without collapsing while the user edits", async () => {
  useComposerDraftStore.getState().addFiles(
    ref,
    [
      {
        type: "file",
        id: "pending",
        name: "x.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        file: new File(["x"], "x.txt", { type: "text/plain" }),
      },
    ],
    { appendReference: false },
  );
  useDesktopWorkspaceStore.getState().select(ref, "files");
  await act(async () => {
    renderer = create(<Probe />);
  });
  expect(workspace().composerCollapsed).toBe(false);
  useComposerDraftStore.getState().clearComposerContent(ref);
  await act(async () => renderer!.update(<Probe />));
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "review"));
  expect(workspace().composerCollapsed).toBe(true);
});
it("uses the active queued-edit draft and preserves explicit split-to-pill toggles", async () => {
  const target = DraftId.make("queued-edit:one");
  useComposerDraftStore.getState().setPrompt(target, "Queued edit");
  useDesktopWorkspaceStore.getState().select(ref, "browser");
  await act(async () => {
    renderer = create(<Probe target={target} />);
  });
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => useDesktopWorkspaceStore.getState().toggleSplit(ref));
  await act(async () => {
    toggleDesktopComposer(ref, "browser");
  });
  expect(workspace().splitTabs.browser).toBe(false);
  expect(workspace().composerCollapsed).toBe(true);
  await act(async () => {
    toggleDesktopComposer(ref, "browser");
  });
  expect(workspace().composerCollapsed).toBe(false);
  expect(workspace().splitTabs.browser).toBe(false);
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe("Queued edit");
});
it("keeps retained queued attachments visible on entry without overriding manual hiding", async () => {
  const target = DraftId.make("queued-edit:attachments");
  useDesktopWorkspaceStore.getState().select(ref, "browser");
  await act(async () => {
    renderer = create(<Probe target={target} retainedAttachments />);
  });
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => {
    toggleDesktopComposer(ref, "browser");
  });
  await act(async () => renderer!.update(<Probe target={target} retainedAttachments />));
  expect(workspace().composerCollapsed).toBe(true);
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "files"));
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => renderer!.update(<Probe target={target} />));
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "browser"));
  expect(workspace().composerCollapsed).toBe(true);
});
it("leaves full Chat and standalone web visibility unchanged", async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  expect(toggleDesktopComposer(ref, "chat")).toBe("composer");
  expect(workspace().composerCollapsed).toBe(false);
  await act(async () => renderer!.update(<Probe desktop={false} />));
  await act(async () => useDesktopWorkspaceStore.getState().select(ref, "browser"));
  expect(workspace().composerCollapsed).toBe(false);
});

it.each([ref, DraftId.make("queued-edit:review")])(
  "reveals newly added review comments for draft %j without changing the selected tab",
  async (target) => {
    useDesktopWorkspaceStore.getState().select(ref, "review");
    await act(async () => {
      renderer = create(<Probe target={target} />);
    });
    expect(workspace().composerCollapsed).toBe(true);
    const comment = buildFileReviewComment({
      id: "comment-1",
      filePath: "example.ts",
      startLine: 1,
      endLine: 1,
      text: "Fix this",
      contents: "example",
    });
    const drafts = useComposerDraftStore.getState();
    // A busy editor rejects caret insertion; the store still adds the context chip.
    const dispose = drafts.setContextInsertionHandler(target, () => false);
    try {
      await act(async () => drafts.addReviewComment(target, comment));
      expect(workspace().composerCollapsed).toBe(false);
      expect(workspace().selected).toBe("review");
      expect(workspace().splitTabs).toEqual({});
      expect(drafts.getComposerDraft(target)?.prompt).toContain("t3-context://v1/review-comment/");

      await act(async () => {
        toggleDesktopComposer(ref, "review");
      });
      await act(async () => drafts.addReviewComment(target, { ...comment, text: "Edited" }));
      await act(async () => drafts.removeReviewComment(target, comment.id));
      await act(async () => drafts.setPrompt(target, "Still editing"));
      expect(workspace().composerCollapsed).toBe(true);

      await act(async () => drafts.addReviewComment(target, { ...comment, id: "comment-2" }));
      expect(workspace().composerCollapsed).toBe(false);
      await act(async () => {
        toggleDesktopComposer(ref, "review");
      });
      await act(async () => renderer!.unmount());
      renderer = undefined;
      await act(async () => drafts.addReviewComment(target, { ...comment, id: "after-unmount" }));
      expect(workspace().composerCollapsed).toBe(true);
    } finally {
      dispose?.();
    }
  },
);

it("does not reveal desktop state for review comments in standalone web", async () => {
  useDesktopWorkspaceStore.getState().select(ref, "review");
  useDesktopWorkspaceStore.getState().setCollapsed(ref, true);
  await act(async () => {
    renderer = create(<Probe desktop={false} />);
  });
  await act(async () =>
    useComposerDraftStore.getState().addReviewComment(
      ref,
      buildFileReviewComment({
        id: "web-comment",
        filePath: "example.ts",
        startLine: 1,
        endLine: 1,
        text: "Fix this",
        contents: "example",
      }),
    ),
  );
  expect(workspace().composerCollapsed).toBe(true);
});
