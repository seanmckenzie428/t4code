// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("DiffPanel collapse controls", () => {
  it("keys header collapse actions by file path", () => {
    const source = NodeFS.readFileSync(new URL("./DiffPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("if (file) toggleDiffFileCollapsed(file.filePath)");
    expect(source).toContain("toggleDiffFileCollapsed(filePath)");
    expect(source).not.toContain("toggleDiffFileCollapsed(file.fileKey)");
    expect(source).not.toContain("toggleDiffFileCollapsed(fileKey)");
  });
});
