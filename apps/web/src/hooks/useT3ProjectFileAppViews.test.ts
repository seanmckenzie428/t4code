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

function splitProjectFile(url: string): ProjectReadFileResult {
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
            action: {
              primary: { commandId: "ui.preview.open", args: { url } },
              menu: [
                {
                  label: "Open in external browser",
                  action: { commandId: "ui.external-url.open", args: { url } },
                },
              ],
            },
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
    workspaceBinding: null,
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
      workspaceBinding: null,
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

  it("binds Lotus launcher URLs to the active thread workspace", () => {
    const [manifest] = resolveT3ProjectFileAppViews({
      projectId,
      projectFile: splitProjectFile("https://dev.admin.lotus.localhost"),
      workspaceBinding: {
        extensionId: "lotus-runtime",
        providerId: "lotus",
        workspaceId: "lotus-228",
      },
      worktreePath: "/repo/.worktrees/missing-file",
      worktreeFile: null,
      worktreeFilePending: false,
    });
    const action = manifest?.placements?.[0]?.action;
    if (!action || !("menu" in action)) throw new Error("Expected split launcher action");
    expect(action.primary?.args?.url).toBe("https://lotus-228.admin.lotus.localhost/");
    expect(action.menu[0]?.action.args?.url).toBe("https://lotus-228.admin.lotus.localhost/");
  });

  it("does not bind a Lotus-local URL for another workspace provider", () => {
    const [manifest] = resolveT3ProjectFileAppViews({
      projectId,
      projectFile: projectFile("https://dev.admin.lotus.localhost"),
      workspaceBinding: {
        extensionId: "other-runtime",
        providerId: "other",
        workspaceId: "lotus-228",
      },
      worktreePath: null,
      worktreeFile: null,
      worktreeFilePending: false,
    });
    const action = manifest?.placements?.[0]?.action;
    if (!action || "menu" in action) throw new Error("Expected direct launcher action");
    expect(action.args?.url).toBe("https://dev.admin.lotus.localhost");
  });
});
