import {
  T3_PROJECT_FILE_NAME,
  bindProjectAppViewManifest,
  type AppViewManifest,
  type AppViewPlacementActionItem,
  type EnvironmentId,
  type OrchestrationWorkspaceBinding,
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
const LOTUS_WORKSPACE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOTUS_LOCAL_HOST = /^[^.]+\.(admin|api|store|mail)\.lotus\.localhost$/;

function bindLotusWorkspaceUrl(url: string, workspaceId: string): string {
  if (!LOTUS_WORKSPACE_HOST.test(workspaceId)) return url;
  try {
    const parsed = new URL(url);
    const match = LOTUS_LOCAL_HOST.exec(parsed.hostname);
    if (match === null) return url;
    parsed.hostname = `${workspaceId}.${match[1]}.lotus.localhost`;
    return parsed.toString();
  } catch {
    return url;
  }
}

function bindLotusActionItem(
  action: AppViewPlacementActionItem,
  workspaceId: string,
): AppViewPlacementActionItem {
  if (action.args === undefined) return action;
  return {
    ...action,
    args: { url: bindLotusWorkspaceUrl(action.args.url, workspaceId) },
  };
}

function bindLotusWorkspaceUrls(
  manifest: AppViewManifest,
  workspaceBinding: OrchestrationWorkspaceBinding | null,
): AppViewManifest {
  if (
    workspaceBinding?.extensionId !== "lotus-runtime" ||
    workspaceBinding.providerId !== "lotus" ||
    manifest.placements === undefined
  ) {
    return manifest;
  }
  const workspaceId = workspaceBinding.workspaceId;
  return {
    ...manifest,
    placements: manifest.placements.map((placement) => {
      const action = placement.action;
      if (action === undefined) return placement;
      return {
        ...placement,
        action:
          "menu" in action
            ? {
                ...action,
                ...(action.primary === undefined
                  ? {}
                  : { primary: bindLotusActionItem(action.primary, workspaceId) }),
                menu: action.menu.map((item) => ({
                  ...item,
                  action: bindLotusActionItem(item.action, workspaceId),
                })),
              }
            : bindLotusActionItem(action, workspaceId),
      };
    }),
  };
}

export function resolveT3ProjectFileAppViews(input: {
  projectId: ProjectId | null;
  projectFile: ProjectReadFileResult | null;
  workspaceBinding: OrchestrationWorkspaceBinding | null;
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
    bindLotusWorkspaceUrls(bindProjectAppViewManifest(manifest, projectId), input.workspaceBinding),
  );
}

export function useT3ProjectFileAppViews(
  environmentId: EnvironmentId | null,
  workspaceRoot: string | null,
  projectId: ProjectId | null,
  worktreePath: string | null = null,
  workspaceBinding: OrchestrationWorkspaceBinding | null = null,
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
        workspaceBinding,
        worktreePath: distinctWorktreePath,
        worktreeFile: worktreeQuery.data,
        worktreeFilePending: worktreeQuery.isPending,
      }),
    [
      distinctWorktreePath,
      projectId,
      projectQuery.data,
      workspaceBinding,
      worktreeQuery.data,
      worktreeQuery.isPending,
    ],
  );
}
