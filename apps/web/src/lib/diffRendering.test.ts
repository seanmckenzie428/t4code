import { retainCurrentDiffFileRevisions, toggleAllDiffFiles } from "./diffCollapse";
import { describe, expect, it } from "vite-plus/test";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  buildFileDiffRenderKey,
  buildPatchCacheKey,
  buildFileReviewRevision,
  buildDiffFileReviewSnapshot,
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffFontFamily,
  resolveDiffTheme,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
} from "./diffRendering";

describe("review diff presentation", () => {
  it("matches the app theme by default", () => {
    expect(resolveDiffTheme("light", "app")).toEqual({ name: "pierre-light", type: "light" });
    expect(resolveDiffTheme("dark", "app")).toEqual({ name: "pierre-dark", type: "dark" });
  });

  it("uses the selected code theme in the active light or dark appearance", () => {
    expect(resolveDiffTheme("light", "github")).toEqual({ name: "github-light", type: "light" });
    expect(resolveDiffTheme("dark", "solarized")).toEqual({
      name: "solarized-dark",
      type: "dark",
    });
    expect(resolveDiffTheme("dark", "jetbrains")).toEqual({
      name: "material-theme",
      type: "dark",
    });
  });

  it("resolves fonts from vetted stacks", () => {
    expect(resolveDiffFontFamily("jetbrains-mono")).toContain("JetBrains Mono");
    expect(resolveDiffFontFamily("system-mono")).toContain("ui-monospace");
  });
});

describe("buildPatchCacheKey", () => {
  it("normalizes outer whitespace before hashing", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(`\n${patch}\n`)).toBe(buildPatchCacheKey(patch));
  });

  it("changes when diff content changes", () => {
    const before = "diff --git a/a.ts b/a.ts\n+console.log('hello')";
    const after = "diff --git a/a.ts b/a.ts\n+console.log('hello world')";

    expect(buildPatchCacheKey(before)).not.toBe(buildPatchCacheKey(after));
  });

  it("changes when cache scope changes", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch, "diff-panel:light")).not.toBe(
      buildPatchCacheKey(patch, "diff-panel:dark"),
    );
  });
});

describe("getRenderablePatch", () => {
  it.each([
    ["a/example.ts", "a/example.ts"],
    ["b/example.ts", "b/example.ts"],
    ["a/before.ts", "b/after.ts"],
  ])("preserves repository paths from %s to %s", (previousPath, path) => {
    const parsed = getRenderablePatch(
      [
        `diff --git a/${previousPath} b/${path}`,
        ...(previousPath === path
          ? []
          : ["similarity index 50%", `rename from ${previousPath}`, `rename to ${path}`]),
        `--- a/${previousPath}`,
        `+++ b/${path}`,
        "@@ -1 +1 @@",
        "-before",
        "+after",
      ].join("\n"),
    );
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    const file = parsed.files[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(resolveFileDiffPath(file)).toBe(path);
    expect(resolveFileDiffPreviousPath(file)).toBe(previousPath);
    expect(buildFileDiffIdentityKey(file)).toBe(`${previousPath}\0${path}`);
  });

  it("compacts partial hunk render offsets for virtualized review diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "index 1111111..2222222 100644",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,4 +48,4 @@",
      " context",
      "-before",
      "+after",
      " context",
      " context",
      "@@ -80,3 +80,4 @@",
      " context",
      "+added",
      " context",
      " context",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "review", {
      compactPartialHunkOffsets: true,
    });
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const file = parsed.files[0];
    expect(file?.hunks[0]?.collapsedBefore).toBe(47);
    expect(file?.hunks[0]?.unifiedLineStart).toBe(0);
    expect(file?.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
    expect(file?.hunks[1]?.unifiedLineStart).toBe(file?.hunks[0]?.unifiedLineCount);
    expect(file?.unifiedLineCount).toBe(
      file?.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0),
    );
  });

  it("retains source-file offsets for checkpoint diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,1 +48,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "checkpoint");
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    expect(parsed.files[0]?.hunks[0]?.unifiedLineStart).toBe(47);
  });
});

describe("lazy diff review state", () => {
  it("keeps unloaded files in review membership without inventing their revision", () => {
    const patch = (path: string, contents: string) => [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-before",
      `+${contents}`,
    ].join("\n");
    const parsed = getRenderablePatch(`${patch("first.ts", "after")}\n${patch("later.ts", "after")}`);
    if (parsed?.kind !== "files") throw new Error("Expected file diffs");
    const complete = buildDiffFileReviewSnapshot(parsed.files, null);
    const reloading = buildDiffFileReviewSnapshot(parsed.files, new Set(["first.ts"]));
    expect(reloading.filePaths).toEqual(["first.ts", "later.ts"]);
    expect(reloading.revisions.get("first.ts")).toBe(complete.revisions.get("first.ts"));
    expect(reloading.revisions.has("later.ts")).toBe(false);
    const paths = new Set(reloading.filePaths);
    expect(retainCurrentDiffFileRevisions(paths, complete.revisions)).toEqual(complete.revisions);
    expect(toggleAllDiffFiles(reloading.filePaths, new Set())).toEqual(paths);
  });
});

describe("buildFileReviewRevision", () => {
  const parseFile = (replacement: string, scope: string) => {
    const parsed = getRenderablePatch(
      [
        "diff --git a/example.ts b/example.ts",
        "--- a/example.ts",
        "+++ b/example.ts",
        "@@ -1 +1 @@",
        "-before",
        `+${replacement}`,
      ].join("\n"),
      scope,
    );
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") throw new Error("Expected parsed files");
    return parsed.files[0]!;
  };

  it("ignores Pierre cache scope while tracking file content", () => {
    expect(buildFileReviewRevision(parseFile("after", "light"))).toBe(
      buildFileReviewRevision(parseFile("after", "dark")),
    );
    expect(buildFileReviewRevision(parseFile("after", "light"))).not.toBe(
      buildFileReviewRevision(parseFile("changed again", "light")),
    );
  });
});

describe("buildFileDiffRenderKey", () => {
  it("keeps file identity stable when Pierre hydrates a partial diff", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1 +1 @@",
      "-before",
      "+after",
    ].join("\n");
    const parsed = getRenderablePatch(patch, "hydrated-key");
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const file = parsed.files[0];
    expect(file).toBeDefined();
    if (!file) return;
    const key = buildFileDiffRenderKey(file);
    file.cacheKey = `${file.cacheKey}:hydrated`;

    expect(buildFileDiffRenderKey(file)).toBe(key);
  });

  it("keeps identities stable and versions local to the changed file", () => {
    const patch = (secondLine: string) =>
      [
        "diff --git a/unchanged.ts b/unchanged.ts",
        "--- a/unchanged.ts",
        "+++ b/unchanged.ts",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "diff --git a/changed.ts b/changed.ts",
        "--- a/changed.ts",
        "+++ b/changed.ts",
        "@@ -1 +1 @@",
        "-old",
        `+${secondLine}`,
      ].join("\n");
    const before = getRenderablePatch(patch("new"), "before");
    const after = getRenderablePatch(patch("newer"), "after");
    expect(before?.kind).toBe("files");
    expect(after?.kind).toBe("files");
    if (before?.kind !== "files" || after?.kind !== "files") return;

    const [beforeUnchanged, beforeChanged] = before.files;
    const [afterUnchanged, afterChanged] = after.files;
    expect(beforeUnchanged).toBeDefined();
    expect(beforeChanged).toBeDefined();
    expect(afterUnchanged).toBeDefined();
    expect(afterChanged).toBeDefined();
    if (!beforeUnchanged || !beforeChanged || !afterUnchanged || !afterChanged) return;

    expect(buildFileDiffIdentityKey(afterUnchanged)).toBe(
      buildFileDiffIdentityKey(beforeUnchanged),
    );
    expect(buildFileDiffIdentityKey(afterChanged)).toBe(buildFileDiffIdentityKey(beforeChanged));
    expect(buildFileDiffContentVersion(afterUnchanged)).toBe(
      buildFileDiffContentVersion(beforeUnchanged),
    );
    expect(buildFileDiffContentVersion(afterChanged)).not.toBe(
      buildFileDiffContentVersion(beforeChanged),
    );
  });
});

describe("getDiffLineStat", () => {
  it("totals additions and deletions across every file and hunk", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1,2 +1,3 @@",
      "-before",
      "+after",
      "+added",
      " context",
      "@@ -10,2 +11,1 @@",
      "-removed",
      " context",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " title",
      "+description",
    ].join("\n");

    const parsed = getRenderablePatch(patch);
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    expect(getDiffLineStat(parsed.files)).toEqual({ additions: 3, deletions: 2 });
  });
});
