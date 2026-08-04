import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const codeViewCapture = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: (props: { options?: Record<string, unknown> }) => {
    codeViewCapture.options = props.options ?? null;
    return null;
  },
}));

import { DraftId } from "~/composerDraftStore";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";

import { AnnotatableCodeView } from "./AnnotatableCodeView";

describe("AnnotatableCodeView", () => {
  it("wires Pierre's gutter plus to selection before comment creation", () => {
    const parsed = getRenderablePatch(
      [
        "diff --git a/example.ts b/example.ts",
        "--- a/example.ts",
        "+++ b/example.ts",
        "@@ -1 +1 @@",
        "-before",
        "+after",
      ].join("\n"),
      "annotatable-code-view-test",
    );
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    const fileDiff = parsed.files[0]!;

    renderToStaticMarkup(
      <AnnotatableCodeView
        files={[
          {
            fileDiff,
            filePath: resolveFileDiffPath(fileDiff),
            fileKey: fileDiff.cacheKey ?? fileDiff.name,
            collapsed: false,
          },
        ]}
        sectionId="working-tree"
        sectionTitle="Working tree"
        composerDraftTarget={DraftId.make("annotatable-code-view-test")}
        options={{}}
        renderHeaderPrefix={() => null}
      />,
    );

    const gutterClick = codeViewCapture.options?.onGutterUtilityClick;
    const selectionEnd = codeViewCapture.options?.onLineSelectionEnd;
    expect(gutterClick).toBeTypeOf("function");
    expect(selectionEnd).toBeTypeOf("function");
    expect(gutterClick).not.toBe(selectionEnd);
  });
});
