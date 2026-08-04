import {
  ProjectSaveAppViewError,
  T3ProjectFile,
  T3_PROJECT_FILE_NAME,
  type AppViewManifest,
  type ProjectId,
  type ProjectSaveAppViewResult,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";

const decodeProjectFile = Schema.decodeEffect(T3ProjectFileFromJson);
const decodeUnknownJson = Schema.decodeEffect(fromLenientJson(Schema.Unknown));

function failure(
  projectId: ProjectId,
  reason: ProjectSaveAppViewError["failure"],
  message: string,
) {
  return new ProjectSaveAppViewError({ projectId, failure: reason, message });
}

function isWithinRoot(path: Path.Path, root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function formattingFor(raw: string | null): {
  readonly indentation: string | number;
  readonly newline: "\n" | "\r\n";
  readonly trailingNewline: boolean;
} {
  if (raw === null) return { indentation: 2, newline: "\n", trailingNewline: true };
  const indentation = raw.match(/^([\t ]+)\S/m)?.[1] ?? "  ";
  return {
    indentation,
    newline: raw.includes("\r\n") ? "\r\n" : "\n",
    trailingNewline: /\r?\n$/.test(raw),
  };
}

export function mergeProjectAppView(
  projectId: ProjectId,
  raw: string | null,
  manifest: AppViewManifest,
): Effect.Effect<
  { readonly contents: string; readonly change: "created" | "updated" },
  ProjectSaveAppViewError
> {
  return Effect.gen(function* () {
    if (manifest.scope.kind !== "project" || manifest.scope.projectId !== projectId) {
      return yield* failure(
        projectId,
        "manifest_scope_mismatch",
        "The generated view must be scoped to the project being saved.",
      );
    }

    const current =
      raw === null
        ? {}
        : yield* decodeUnknownJson(raw).pipe(
            Effect.mapError(() =>
              failure(projectId, "invalid_project_file", "t3.json is not valid JSON or JSONC."),
            ),
          );
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return yield* failure(projectId, "invalid_project_file", "t3.json must contain an object.");
    }
    if (raw !== null) {
      yield* decodeProjectFile(raw).pipe(
        Effect.mapError(() =>
          failure(
            projectId,
            "invalid_project_file",
            "Fix the existing t3.json validation errors before saving this view.",
          ),
        ),
      );
    }

    const record = current as Record<string, unknown>;
    const appViews = Array.isArray(record.appViews) ? record.appViews : [];
    const existingIndex = appViews.findIndex(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === manifest.id,
    );
    const nextViews = [...appViews];
    if (existingIndex >= 0) nextViews[existingIndex] = manifest;
    else nextViews.push(manifest);
    const next = { ...record, appViews: nextViews };

    yield* Schema.decodeUnknownEffect(T3ProjectFile)(next).pipe(
      Effect.mapError(() =>
        failure(projectId, "invalid_project_file", "The generated view is not valid t3.json data."),
      ),
    );

    const formatting = formattingFor(raw);
    // Custom indentation and newline preservation is the purpose of this serialization.
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    let contents = JSON.stringify(next, null, formatting.indentation).replaceAll(
      "\n",
      formatting.newline,
    );
    if (formatting.trailingNewline) contents += formatting.newline;
    return { contents, change: existingIndex >= 0 ? "updated" : "created" } as const;
  });
}

export function saveProjectAppView(input: {
  readonly workspaceRoot: string;
  readonly projectId: ProjectId;
  readonly manifest: AppViewManifest;
  readonly workspaceFileSystem: WorkspaceFileSystem.WorkspaceFileSystem["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}): Effect.Effect<ProjectSaveAppViewResult, ProjectSaveAppViewError> {
  return Effect.gen(function* () {
    const realRoot = yield* input.fileSystem
      .realPath(input.workspaceRoot)
      .pipe(
        Effect.mapError(() =>
          failure(input.projectId, "read_failed", "The project workspace could not be opened."),
        ),
      );
    const targetPath = input.path.join(realRoot, T3_PROJECT_FILE_NAME);
    const realTarget = yield* input.fileSystem.realPath(targetPath).pipe(
      Effect.map((value) => value as string | null),
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(
                failure(
                  input.projectId,
                  "read_failed",
                  "The existing t3.json could not be opened.",
                ),
              ),
      }),
    );
    if (realTarget !== null && !isWithinRoot(input.path, realRoot, realTarget)) {
      return yield* failure(
        input.projectId,
        "read_failed",
        "The existing t3.json resolves outside the project workspace.",
      );
    }
    const raw =
      realTarget === null
        ? null
        : yield* input.fileSystem
            .readFileString(realTarget)
            .pipe(
              Effect.mapError(() =>
                failure(input.projectId, "read_failed", "The existing t3.json could not be read."),
              ),
            );
    const merged = yield* mergeProjectAppView(input.projectId, raw, input.manifest);
    yield* input.workspaceFileSystem
      .writeFile({
        cwd: realRoot,
        relativePath: T3_PROJECT_FILE_NAME,
        contents: merged.contents,
      })
      .pipe(
        Effect.mapError(() =>
          failure(
            input.projectId,
            "write_failed",
            "The generated view could not be saved to t3.json.",
          ),
        ),
      );
    return {
      relativePath: T3_PROJECT_FILE_NAME,
      viewId: input.manifest.id,
      change: merged.change,
    };
  });
}
