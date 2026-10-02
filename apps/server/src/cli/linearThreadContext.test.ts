// @effect-diagnostics nodeBuiltinImport:off -- Test real local Git worktree validation without a server or provider.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";
import { validateLinearThreadContext } from "./linearThreadContext.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t4-linear-context-"));
  roots.push(root);
  const projectRoot = NodePath.join(root, "lotus");
  const worktreePath = NodePath.join(root, "deliverylabel");
  const branch = "LOTUS-264-deliverylabel";
  const git = (args: string[]) => NodeChildProcess.execFileSync("git", args, { stdio: "ignore" });
  git(["init", projectRoot]);
  git([
    "-C",
    projectRoot,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  git(["-C", projectRoot, "worktree", "add", "-b", branch, worktreePath]);
  return {
    version: 1,
    projectRoot,
    worktreePath,
    branch,
    issue: {
      identifier: "LOTUS-264",
      title: "Rename button",
      description: "Fix wording",
      context: "Rename button\nFix wording\n'`$(do-not-run)`",
    },
  };
}

describe("Linear thread context", () => {
  it("accepts the existing worktree and preserves issue text as data", async () => {
    const handoff = await fixture();
    const result = await validateLinearThreadContext(JSON.stringify(handoff));
    expect(result).toMatchObject({ branch: handoff.branch, title: "LOTUS-264 Rename button" });
    expect(result.prompt).toContain("$grill-me");
    expect(result.prompt).toContain("stack startup may still be running");
    expect(result.prompt).toContain("do not start or recreate the stack yourself");
    expect(result.prompt).toContain(JSON.stringify(handoff.issue));
  });
  it("preserves the launcher-rendered custom prompt", async () => {
    const handoff = await fixture();
    const prompt = "Use my workflow.\n\n" + JSON.stringify(handoff.issue);
    const result = await validateLinearThreadContext(JSON.stringify({ ...handoff, prompt }));
    expect(result.prompt).toBe(prompt);
  });
  it("accepts workspace-only context without adding a message", async () => {
    const { issue: _issue, ...context } = await fixture();
    const result = await validateLinearThreadContext(
      JSON.stringify({ ...context, version: 2, title: "deliverylabel" }),
    );
    expect(result.title).toBe("deliverylabel");
    expect(result).not.toHaveProperty("prompt");
    expect(result.worktreePath).toBe(await NodeFSP.realpath(context.worktreePath));
  });
  it("rejects unrelated repositories and changed branches", async () => {
    const handoff = await fixture();
    await expect(
      validateLinearThreadContext(JSON.stringify({ ...handoff, branch: "wrong" })),
    ).rejects.toThrow("exact project");
    const other = await fixture();
    await expect(
      validateLinearThreadContext(JSON.stringify({ ...handoff, worktreePath: other.worktreePath })),
    ).rejects.toThrow("exact project");
  });
  it("rejects oversized or missing issue context before any launch", async () => {
    await expect(validateLinearThreadContext("x".repeat(65537))).rejects.toThrow("64 KiB");
    await expect(validateLinearThreadContext("{}")).rejects.toThrow();
  });
});
