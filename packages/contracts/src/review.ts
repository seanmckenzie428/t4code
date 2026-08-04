import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { ProjectReadFileError, ProjectReadFileResult } from "./project.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const ReviewWorkingTreeFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  previousPath: Schema.optionalKey(TrimmedNonEmptyString),
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new"]),
});
export type ReviewWorkingTreeFileContentsInput = typeof ReviewWorkingTreeFileContentsInput.Type;

export const ReviewWorkingTreeFileContentsResult = Schema.Struct({
  oldFile: Schema.NullOr(ProjectReadFileResult),
  newFile: ProjectReadFileResult,
});
export type ReviewWorkingTreeFileContentsResult = typeof ReviewWorkingTreeFileContentsResult.Type;

export const ReviewWorkingTreeFileContentsError = Schema.Union([
  ReviewDiffPreviewError,
  ProjectReadFileError,
]);
export type ReviewWorkingTreeFileContentsError = typeof ReviewWorkingTreeFileContentsError.Type;
