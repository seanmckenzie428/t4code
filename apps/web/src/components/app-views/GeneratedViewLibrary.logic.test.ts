import {
  AppViewId,
  AppViewRevision,
  ProjectId,
  ThreadId,
  type NativeAppViewManifest,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  generatedViewDeleteConfirmation,
  generatedViewLibraryEntries,
  projectAppViewSaveInput,
} from "./GeneratedViewLibrary.logic";

const manifest = (id: string, title: string): NativeAppViewManifest => ({
  id: AppViewId.make(id),
  revision: AppViewRevision.make(1),
  title,
  kind: "native",
  scope: { kind: "thread", threadId: ThreadId.make("thread-1") },
  root: { id: "root", type: "text", value: title },
});

describe("generated view library", () => {
  it("combines thread and personal views without duplicates", () => {
    const health = manifest("health", "Health");
    const release = manifest("release", "Release");
    expect(
      generatedViewLibraryEntries({
        threadViews: { health },
        personalViews: { health: { ...health, scope: { kind: "personal" } }, release },
        openViewIds: new Set(["health"]),
      }),
    ).toMatchObject([
      { id: "health", isOpen: true, isPersonal: true, isThreadView: true },
      { id: "release", isOpen: false, isPersonal: true, isThreadView: false },
    ]);
  });

  it("builds a project-scoped direct-save request", () => {
    const projectId = ProjectId.make("project-1");
    expect(projectAppViewSaveInput(projectId, manifest("health", "Health"))).toMatchObject({
      projectId,
      manifest: { id: "health", scope: { kind: "project", projectId } },
    });
  });

  it("describes every durable copy before deleting a view", () => {
    expect(
      generatedViewDeleteConfirmation({
        title: "Project Cockpit",
        isThreadView: true,
        isPersonal: true,
        hasProjectProposal: true,
      }),
    ).toContain("saved personal copy");
    expect(
      generatedViewDeleteConfirmation({
        title: "Project Cockpit",
        isThreadView: true,
        isPersonal: true,
        hasProjectProposal: true,
      }),
    ).toContain("pending project-save proposal");
  });
});
