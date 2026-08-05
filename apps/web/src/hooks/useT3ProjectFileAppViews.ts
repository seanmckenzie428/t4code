import {
  T3_PROJECT_FILE_NAME,
  bindProjectAppViewManifest,
  type AppViewManifest,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeT3ProjectFile = Schema.decodeExit(T3ProjectFileFromJson);
const NO_APP_VIEWS: ReadonlyArray<AppViewManifest> = [];

export function useT3ProjectFileAppViews(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  projectId: ProjectId | null,
): ReadonlyArray<AppViewManifest> {
  const query = useProjectFileQuery(
    environmentId ?? ("" as EnvironmentId),
    cwd ?? "",
    T3_PROJECT_FILE_NAME,
    environmentId !== null && cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  return useMemo(() => {
    if (contents === null || projectId === null) return NO_APP_VIEWS;
    const decoded = decodeT3ProjectFile(contents);
    if (Exit.isFailure(decoded)) return NO_APP_VIEWS;
    return (decoded.value.appViews ?? []).map((manifest) =>
      bindProjectAppViewManifest(manifest, projectId),
    );
  }, [contents, projectId]);
}
