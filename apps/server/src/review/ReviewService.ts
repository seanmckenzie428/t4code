import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  ProjectReadFileError,
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewWorkingTreeFileContentsError,
  type ReviewWorkingTreeFileContentsInput,
  type ReviewWorkingTreeFileContentsResult,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getWorkingTreeFileContents: (
      input: ReviewWorkingTreeFileContentsInput,
    ) => Effect.Effect<ReviewWorkingTreeFileContentsResult, ReviewWorkingTreeFileContentsError>;
  }
>()("t3/review/ReviewService") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

  const canonicalizePath = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: "ReviewService.assertWorkspaceBoundCwd.canonicalizePath",
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the review workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  const isWithinRoot = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    cwd: string,
  ) {
    const [candidate, workspaceRoot, worktreesRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
      canonicalizePath(config.worktreesDir),
    ]);

    if (isWithinRoot(candidate, workspaceRoot) || isWithinRoot(candidate, worktreesRoot)) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({
      operation: "ReviewService.getDiffPreview",
      cwd,
      detail: "Review diff preview cwd must stay within the configured workspace root.",
    });
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd(input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(input);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const readWorkspaceFile = (input: { readonly cwd: string; readonly relativePath: string }) =>
    workspaceFileSystem.readFile(input).pipe(
      Effect.mapError((cause) => {
        const failureContext = (() => {
          switch (cause._tag) {
            case "WorkspacePathOutsideRootError":
              return { failure: "workspace_path_outside_root" } as const;
            case "WorkspaceFileSystemOperationError":
              return {
                failure: "operation_failed",
                resolvedPath: cause.resolvedPath,
                operation: cause.operation,
                operationPath: cause.operationPath,
              } as const;
            case "WorkspaceFilePathEscapeError":
              return {
                failure: "resolved_path_outside_root",
                resolvedPath: cause.resolvedPath,
                resolvedWorkspaceRoot: cause.resolvedWorkspaceRoot,
              } as const;
            case "WorkspacePathNotFileError":
              return { failure: "path_not_file", resolvedPath: cause.resolvedPath } as const;
            case "WorkspaceBinaryFileError":
              return { failure: "binary_file", resolvedPath: cause.resolvedPath } as const;
          }
        })();
        return new ProjectReadFileError({ ...input, ...failureContext, cause });
      }),
    );

  const getWorkingTreeFileContents: ReviewService["Service"]["getWorkingTreeFileContents"] =
    Effect.fn("ReviewService.getWorkingTreeFileContents")(function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);

      const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
      if (!handle) {
        return yield* new VcsRepositoryDetectionError({
          operation: "ReviewService.getWorkingTreeFileContents",
          cwd: input.cwd,
          detail: "Editing review diffs requires a Git working tree.",
        });
      }
      if (handle.kind !== "git") {
        return yield* new VcsUnsupportedOperationError({
          operation: "ReviewService.getWorkingTreeFileContents",
          kind: handle.kind,
          detail: "Editing review diffs requires a Git working tree.",
        });
      }

      const newFile = yield* readWorkspaceFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
      if (input.changeType === "new") {
        return { oldFile: null, newFile };
      }

      const requestedPreviousPath = input.previousPath ?? input.relativePath;
      const previousPath = yield* workspacePaths
        .resolveRelativePathWithinRoot({
          workspaceRoot: input.cwd,
          relativePath: requestedPreviousPath,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectReadFileError({
                cwd: input.cwd,
                relativePath: requestedPreviousPath,
                failure: "workspace_path_outside_root",
                cause,
              }),
          ),
        );
      const oldFileContents = yield* git.execute({
        operation: "ReviewService.getWorkingTreeFileContents.oldFile",
        cwd: input.cwd,
        args: ["show", `HEAD:${previousPath.relativePath}`],
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
        appendTruncationMarker: false,
      });
      const oldFile = {
        relativePath: previousPath.relativePath,
        contents: oldFileContents.stdout,
        byteLength: new TextEncoder().encode(oldFileContents.stdout).byteLength,
        truncated: oldFileContents.stdoutTruncated,
      };
      return { oldFile, newFile };
    });

  return ReviewService.of({
    getDiffPreview,
    getWorkingTreeFileContents,
  });
});

export const layer = Layer.effect(ReviewService, make);
