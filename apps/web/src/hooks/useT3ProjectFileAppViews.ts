import {
  T3_PROJECT_FILE_NAME,
  bindProjectAppViewManifest,
  type AppViewManifest,
  type EnvironmentId,
  type ProjectId,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeT3ProjectFile = Schema.decodeExit(T3ProjectFileFromJson);
const NO_APP_VIEWS: ReadonlyArray<AppViewManifest> = [];

export function resolveT3ProjectFileAppViews(input: {
  projectId: ProjectId | null;
  projectFile: ProjectReadFileResult | null;
  worktreePath: string | null;
  worktreeFile: ProjectReadFileResult | null;
  worktreeFilePending: boolean;
}): ReadonlyArray<AppViewManifest> {
  const projectId = input.projectId;
  if (projectId === null) return NO_APP_VIEWS;
  const file =
    input.worktreePath === null
      ? input.projectFile
      : input.worktreeFile !== null
        ? input.worktreeFile
        : input.worktreeFilePending
          ? null
          : input.projectFile;
  if (file === null || file.truncated) return NO_APP_VIEWS;
  const decoded = decodeT3ProjectFile(file.contents);
  if (Exit.isFailure(decoded)) return NO_APP_VIEWS;
  return (decoded.value.appViews ?? []).map((manifest) =>
    bindProjectAppViewManifest(manifest, projectId),
  );
}

export function useT3ProjectFileAppViews(
  environmentId: EnvironmentId | null,
  workspaceRoot: string | null,
  projectId: ProjectId | null,
  worktreePath: string | null = null,
): ReadonlyArray<AppViewManifest> {
  const distinctWorktreePath = worktreePath === workspaceRoot ? null : worktreePath;
  const worktreeQuery = useProjectFileQuery(
    environmentId ?? ("" as EnvironmentId),
    distinctWorktreePath ?? "",
    T3_PROJECT_FILE_NAME,
    environmentId !== null && distinctWorktreePath !== null,
  );
  const projectQuery = useProjectFileQuery(
    environmentId ?? ("" as EnvironmentId),
    workspaceRoot ?? "",
    T3_PROJECT_FILE_NAME,
    environmentId !== null && workspaceRoot !== null,
  );
  return useMemo(
    () =>
      resolveT3ProjectFileAppViews({
        projectId,
        projectFile: projectQuery.data,
        worktreePath: distinctWorktreePath,
        worktreeFile: worktreeQuery.data,
        worktreeFilePending: worktreeQuery.isPending,
      }),
    [
      distinctWorktreePath,
      projectId,
      projectQuery.data,
      worktreeQuery.data,
      worktreeQuery.isPending,
    ],
  );
}
