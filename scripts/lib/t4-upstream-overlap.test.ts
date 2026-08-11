import { describe, expect, it } from "vite-plus/test";

import { findT4UpstreamOverlaps, parseGitPathList } from "./t4-upstream-overlap.ts";

describe("t4-upstream-overlap", () => {
  it("parses NUL-delimited Git paths without losing spaces", () => {
    expect(parseGitPathList("apps/web/a.ts\0docs/a file.md\0")).toEqual([
      "apps/web/a.ts",
      "docs/a file.md",
    ]);
  });

  it("returns unique, sorted paths changed by both T4 and upstream", () => {
    expect(
      findT4UpstreamOverlaps(
        ["t4-only.ts", "shared-b.ts", "shared-a.ts", "shared-b.ts"],
        ["upstream-only.ts", "shared-a.ts", "shared-b.ts"],
      ),
    ).toEqual(["shared-a.ts", "shared-b.ts"]);
  });
});
