import { parsePatchFiles, type CodeViewDiffItem } from "@pierre/diffs";
import type { CodeViewProps } from "@pierre/diffs/react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, useState, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("~/composerDraftStore", () => {
  const store = {
    addReviewComment: vi.fn(),
    removeReviewComment: vi.fn(),
    getComposerDraft: () => undefined,
  };
  return { useComposerDraftStore: (select: (state: typeof store) => unknown) => select(store) };
});
vi.mock("../ui/toast", () => ({ toastManager: { add: notify } }));

// Exercise the real review controls with a stateful editor transport. Like Pierre, its
// unsaved document belongs to the mounted item and is discarded on teardown/collapse.
vi.mock("./StyledDiffCodeView", () => ({
  StyledDiffCodeView: (props: CodeViewProps<unknown>) => (
    <>
      {props.items?.map((item) =>
        item.type === "diff" ? (
          <section key={item.id}>
            {props.renderHeaderMetadata?.(item)}
            {item.edit && !item.collapsed ? (
              <EditorTransport item={item} onChange={props.onItemEditChange} />
            ) : (
              <pre>{item.fileDiff.additionLines.join("")}</pre>
            )}
          </section>
        ) : null,
      )}
    </>
  ),
}));

import { AnnotatableCodeView } from "./AnnotatableCodeView";

function EditorTransport({
  item,
  onChange,
}: {
  item: CodeViewDiffItem<unknown>;
  onChange: CodeViewProps<unknown>["onItemEditChange"];
}) {
  const [contents, setContents] = useState(() => item.fileDiff.additionLines.join(""));
  return (
    <textarea
      aria-label={`Contents of ${item.fileDiff.name}`}
      value={contents}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setContents(next);
        onChange?.(item, { name: item.fileDiff.name, contents: next });
      }}
    />
  );
}

type Props = ComponentProps<typeof AnnotatableCodeView>;
function reviewFile(path: string, contents: string, version = 1): Props["files"][number] {
  const fileDiff = parsePatchFiles(
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${contents}\n`,
  )[0]!.files[0]!;
  return {
    fileDiff,
    filePath: path,
    fileKey: path,
    fileVersion: version,
    collapsed: false,
    editable: true,
  };
}

const initialFiles = [reviewFile("one.txt", "initial"), reviewFile("two.txt", "other")];
const baseProps = {
  codeViewKey: "review:initial",
  files: initialFiles,
  sectionId: "working-tree",
  sectionTitle: "Working tree",
  composerDraftTarget: {
    environmentId: EnvironmentId.make("test"),
    threadId: ThreadId.make("test"),
  },
  options: {},
  renderHeaderFilenameSuffix: () => null,
  renderHeaderPrefix: () => null,
  editable: true,
} satisfies Props;

let renderer: ReactTestRenderer;

async function click(label: string) {
  const button = renderer.root
    .findAllByType("button")
    .find((node) => node.props["aria-label"] === label);
  expect(button).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => button!.props.onClick({ stopPropagation() {} }));
}

async function type(contents: string) {
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ currentTarget: { value: contents } });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notify.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("diff edit lifecycle", () => {
  it("keeps the unsaved document through lazy refreshes and collapse until saved", async () => {
    const save = vi.fn(async () => {});
    const props = { ...baseProps, onSaveFile: save };
    await act(async () => {
      renderer = create(<AnnotatableCodeView {...props} />);
    });
    await click("Edit one.txt");
    await type("unsaved first line\n");

    // A larger refreshed patch can temporarily disable editing and remove loaded items.
    await act(async () => {
      renderer.update(
        <AnnotatableCodeView {...props} codeViewKey="review:refresh" files={[]} editable={false} />,
      );
    });
    expect(renderer.root.findByType("textarea").props.value).toBe("unsaved first line\n");
    await type("unsaved first line\ncontinued during refresh\n");

    const refreshed = initialFiles.map((file) => ({
      ...reviewFile(file.filePath, "changed on disk", 2),
      collapsed: true,
    }));
    await act(async () => {
      renderer.update(
        <AnnotatableCodeView {...props} codeViewKey="review:collapsed" files={refreshed} />,
      );
    });
    expect(renderer.root.findByType("textarea").props.value).toBe(
      "unsaved first line\ncontinued during refresh\n",
    );
    await type("unsaved first line\ncontinued during refresh\ncontinued after collapse\n");
    await click("Save diff edit");

    expect(save).toHaveBeenCalledExactlyOnceWith(
      "one.txt",
      "unsaved first line\ncontinued during refresh\ncontinued after collapse\n",
    );
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
  });

  it("keeps the current review after Cancel and rejects edits that fail preparation", async () => {
    const save = vi.fn(async () => {});
    const prepare = vi.fn(async () => {});
    const props = { ...baseProps, onSaveFile: save, onPrepareEdit: prepare };
    await act(async () => {
      renderer = create(<AnnotatableCodeView {...props} />);
    });
    await click("Edit one.txt");
    await type("discard this\n");
    const refreshed = [reviewFile("one.txt", "current disk text", 2)];
    await act(async () => {
      renderer.update(
        <AnnotatableCodeView {...props} codeViewKey="review:new" files={refreshed} />,
      );
    });
    await click("Cancel diff edit");
    expect(renderer.root.findByType("pre").children.join("")).toContain("current disk text");
    expect(save).not.toHaveBeenCalled();

    prepare.mockRejectedValueOnce(
      new Error("Files larger than 1 MB cannot be edited in the diff view."),
    );
    await click("Edit one.txt");
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(renderer.root.findByType("pre").children.join("")).toContain("current disk text");
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Could not edit diff file",
        description: "Files larger than 1 MB cannot be edited in the diff view.",
      }),
    );
  });
});
