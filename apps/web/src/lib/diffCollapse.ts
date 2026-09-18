export function areAllDiffFilesCollapsed(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): boolean {
  return fileKeys.length > 0 && fileKeys.every((fileKey) => collapsedFileKeys.has(fileKey));
}

export function toggleAllDiffFiles(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) ? new Set() : new Set(fileKeys);
}

export type DiffFileReviewState = "unviewed" | "viewed" | "changed";

export function getDiffFileReviewState(
  filePath: string,
  currentRevision: string,
  reviewedRevisions: ReadonlyMap<string, string>,
): DiffFileReviewState {
  const reviewedRevision = reviewedRevisions.get(filePath);
  if (reviewedRevision === undefined) return "unviewed";
  return reviewedRevision === currentRevision ? "viewed" : "changed";
}

export function setDiffFileViewed(
  filePath: string,
  currentRevision: string,
  viewed: boolean,
  reviewedRevisions: ReadonlyMap<string, string>,
  collapsedFilePaths: ReadonlySet<string>,
): {
  readonly reviewedRevisions: ReadonlyMap<string, string>;
  readonly collapsedFilePaths: ReadonlySet<string>;
} {
  const nextReviewed = new Map(reviewedRevisions);
  const nextCollapsed = new Set(collapsedFilePaths);
  if (viewed) {
    nextReviewed.set(filePath, currentRevision);
    nextCollapsed.add(filePath);
  } else {
    nextReviewed.delete(filePath);
    nextCollapsed.delete(filePath);
  }
  return { reviewedRevisions: nextReviewed, collapsedFilePaths: nextCollapsed };
}

export function retainCurrentDiffFileKeys(
  fileKeys: ReadonlySet<string>,
  currentFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...currentFileKeys].filter((fileKey) => fileKeys.has(fileKey)));
}

export function retainCurrentDiffFileRevisions(
  filePaths: ReadonlySet<string>,
  currentRevisions: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map([...currentRevisions].filter(([filePath]) => filePaths.has(filePath)));
}

/** Restore review-driven collapse when a panel opens or its files finish loading. */
export function getDefaultCollapsedDiffFilePaths(
  filePaths: ReadonlyArray<string>,
  currentRevisions: ReadonlyMap<string, string>,
  reviewedRevisions: ReadonlyMap<string, string>,
  collapsedByDefault: boolean,
): ReadonlySet<string> {
  return new Set(
    filePaths.filter((filePath) => {
      const reviewedRevision = reviewedRevisions.get(filePath);
      if (reviewedRevision === undefined) return collapsedByDefault;
      const currentRevision = currentRevisions.get(filePath);
      return currentRevision === undefined || currentRevision === reviewedRevision;
    }),
  );
}
