import type { AppViewManifest, ProjectId, ProjectSaveAppViewInput } from "@t3tools/contracts";

export interface GeneratedViewLibraryEntry {
  readonly id: string;
  readonly manifest: AppViewManifest;
  readonly isOpen: boolean;
  readonly isPersonal: boolean;
  readonly isThreadView: boolean;
}

export function generatedViewLibraryEntries(input: {
  threadViews: Readonly<Record<string, AppViewManifest>>;
  personalViews: Readonly<Record<string, AppViewManifest>>;
  openViewIds: ReadonlySet<string>;
}): GeneratedViewLibraryEntry[] {
  const ids = new Set([...Object.keys(input.threadViews), ...Object.keys(input.personalViews)]);
  return [...ids]
    .map((id) => ({
      id,
      manifest: input.threadViews[id] ?? input.personalViews[id]!,
      isOpen: input.openViewIds.has(id),
      isPersonal: id in input.personalViews,
      isThreadView: id in input.threadViews,
    }))
    .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title));
}

export function projectAppViewSaveInput(
  projectId: ProjectId,
  manifest: AppViewManifest,
): ProjectSaveAppViewInput {
  return {
    projectId,
    manifest: { ...manifest, scope: { kind: "project", projectId } },
  };
}

export function generatedViewDeleteConfirmation(input: {
  readonly title: string;
  readonly isThreadView: boolean;
  readonly isPersonal: boolean;
  readonly hasProjectProposal: boolean;
}): string {
  const effects: string[] = [];
  if (input.isThreadView) effects.push("its thread copy");
  if (input.isPersonal) effects.push("its saved personal copy");
  if (input.hasProjectProposal) effects.push("its pending project-save proposal");
  if (effects.length === 0) effects.push("the view");
  return `Delete “${input.title}”?\n\nThis permanently removes ${effects.join(", ")}. A view already saved in t3.json must be removed from that file separately.`;
}
