import { describe, expect, it } from "vite-plus/test";

import {
  areAllDiffFilesCollapsed,
  getDiffFileReviewState,
  retainCurrentDiffFileKeys,
  retainCurrentDiffFileRevisions,
  setDiffFileViewed,
  toggleAllDiffFiles,
} from "./diffCollapse";

const FILE_KEYS = ["src/app.ts", "src/index.ts"];
const FIRST_FILE_KEY = FILE_KEYS[0]!;

describe("diff collapse controls", () => {
  it("reports whether every rendered file is collapsed", () => {
    expect(areAllDiffFilesCollapsed(FILE_KEYS, new Set(FILE_KEYS))).toBe(true);
    expect(areAllDiffFilesCollapsed(FILE_KEYS, new Set([FIRST_FILE_KEY]))).toBe(false);
    expect(areAllDiffFilesCollapsed([], new Set())).toBe(false);
  });

  it("collapses all files when any rendered file is expanded", () => {
    expect(toggleAllDiffFiles(FILE_KEYS, new Set([FIRST_FILE_KEY]))).toEqual(new Set(FILE_KEYS));
  });

  it("expands all files when every rendered file is collapsed", () => {
    expect(toggleAllDiffFiles(FILE_KEYS, new Set(FILE_KEYS))).toEqual(new Set());
  });

  it("collapses viewed files and expands them when unviewed", () => {
    const viewed = setDiffFileViewed(FIRST_FILE_KEY, "revision-1", true, new Map(), new Set());
    expect(viewed.reviewedRevisions).toEqual(new Map([[FIRST_FILE_KEY, "revision-1"]]));
    expect(viewed.collapsedFilePaths).toEqual(new Set([FIRST_FILE_KEY]));

    const unviewed = setDiffFileViewed(
      FIRST_FILE_KEY,
      "revision-1",
      false,
      viewed.reviewedRevisions,
      viewed.collapsedFilePaths,
    );
    expect(unviewed.reviewedRevisions).toEqual(new Map());
    expect(unviewed.collapsedFilePaths).toEqual(new Set());
  });

  it("requires review again when a viewed file revision changes", () => {
    const reviewed = new Map([[FIRST_FILE_KEY, "revision-1"]]);
    expect(getDiffFileReviewState(FIRST_FILE_KEY, "revision-1", reviewed)).toBe("viewed");
    expect(getDiffFileReviewState(FIRST_FILE_KEY, "revision-2", reviewed)).toBe("changed");
    expect(getDiffFileReviewState(FILE_KEYS[1]!, "revision-1", reviewed)).toBe("unviewed");
  });

  it("drops stale file state after the reviewed patch changes", () => {
    expect(
      retainCurrentDiffFileKeys(new Set(FILE_KEYS), new Set([FIRST_FILE_KEY, "stale-file"])),
    ).toEqual(new Set([FIRST_FILE_KEY]));
    expect(
      retainCurrentDiffFileRevisions(
        new Set(FILE_KEYS),
        new Map([
          [FIRST_FILE_KEY, "revision-1"],
          ["stale-file", "revision-1"],
        ]),
      ),
    ).toEqual(new Map([[FIRST_FILE_KEY, "revision-1"]]));
  });
});
