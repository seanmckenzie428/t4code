import { ProjectId, type ProjectReadFileResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveT3ProjectFileAppViews } from "./useT3ProjectFileAppViews";

const projectId = ProjectId.make("project-1");

function projectFile(url: string): ProjectReadFileResult {
  const contents = JSON.stringify({
    appViews: [
      {
        id: "lotus-admin",
        revision: 1,
        title: "Lotus Admin",
        kind: "native",
        scope: { kind: "project" },
        placements: [
          {
            slot: "chat-topbar",
            action: { commandId: "ui.preview.open", args: { url } },
          },
        ],
        root: { id: "root", type: "text", value: "Lotus Admin" },
      },
    ],
  });
  return {
    relativePath: "t3.json",
    contents,
    byteLength: new TextEncoder().encode(contents).byteLength,
    truncated: false,
  };
}

function launcherUrl(worktreePath: string, file: ProjectReadFileResult): unknown {
  const [manifest] = resolveT3ProjectFileAppViews({
    projectId,
    projectFile: projectFile("https://project.example.test"),
    worktreePath,
    worktreeFile: file,
    worktreeFilePending: false,
  });
  expect(manifest?.id).toBe("lotus-admin");
  const action = manifest?.placements?.[0]?.action;
  if (!action || "menu" in action) throw new Error("Expected direct launcher action");
  return (action.args as { readonly url?: unknown } | undefined)?.url;
}

describe("resolveT3ProjectFileAppViews", () => {
  it("changes a same-id launcher URL when switching same-project worktree chats", () => {
    expect(
      launcherUrl("/repo/.worktrees/thread-a", projectFile("https://worktree-a.example.test")),
    ).toBe("https://worktree-a.example.test");
    expect(
      launcherUrl("/repo/.worktrees/thread-b", projectFile("https://worktree-b.example.test")),
    ).toBe("https://worktree-b.example.test");
  });

  it("falls back to the project-root file when the worktree file is absent", () => {
    const [manifest] = resolveT3ProjectFileAppViews({
      projectId,
      projectFile: projectFile("https://project.example.test"),
      worktreePath: "/repo/.worktrees/missing-file",
      worktreeFile: null,
      worktreeFilePending: false,
    });
    const action = manifest?.placements?.[0]?.action;
    if (!action || "menu" in action) throw new Error("Expected direct launcher action");
    expect((action.args as { readonly url?: unknown } | undefined)?.url).toBe(
      "https://project.example.test",
    );
  });
});
