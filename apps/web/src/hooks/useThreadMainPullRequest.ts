import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { useMemo } from "react";

import { findProjectOnChangeRequestHost, parseChangeRequestUrl } from "../lib/openPullRequestLink";
import { selectThreadMainPullRequest, useMainViewStore } from "../mainViewStore";
import { pullRequestSurface, type PullRequestSurface } from "../rightPanelStore";
import { useProjects, useServerConfigs, useThreadShell } from "../state/entities";

export function resolveThreadMainPullRequest({
  threadRef,
  thread,
  projects,
  capabilities,
  selected,
}: {
  threadRef: ScopedThreadRef | null;
  thread: Pick<
    EnvironmentThreadShell,
    "projectId" | "pullRequests" | "linkedPullRequest" | "branchPullRequest"
  > | null;
  projects: ReadonlyArray<EnvironmentProject>;
  capabilities:
    | Pick<ServerConfig["environment"]["capabilities"], "pullRequests" | "threadPullRequests">
    | undefined;
  selected: PullRequestSurface | null;
}): PullRequestSurface | null {
  if (threadRef === null) return null;
  if (selected !== null) return selected;
  if (thread === null || capabilities?.pullRequests !== true) return null;

  const firstLink =
    capabilities.threadPullRequests === true
      ? visibleThreadPullRequests(thread.pullRequests)[0]
      : undefined;
  if (firstLink) {
    const reference = parseChangeRequestUrl(firstLink.url);
    if (reference === null) return null;
    const environmentProjects = projects
      .filter((project) => project.environmentId === threadRef.environmentId)
      .toSorted(
        (left, right) =>
          Number(right.id === thread.projectId) - Number(left.id === thread.projectId),
      );
    const project = findProjectOnChangeRequestHost(environmentProjects, reference);
    if (project === undefined) return null;
    return pullRequestSurface({
      projectId: project.id,
      host: reference.authority ?? reference.host,
      repository: reference.repository,
      number: reference.number,
      url: firstLink.url,
    });
  }

  const legacy = thread.linkedPullRequest ?? thread.branchPullRequest;
  return legacy ? pullRequestSurface(legacy) : null;
}

/** A null saved selection means the thread's first linked PR, including old list selections. */
export function useThreadMainPullRequest(threadRef: ScopedThreadRef | null) {
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const configs = useServerConfigs();
  const capabilities = threadRef
    ? configs.get(threadRef.environmentId)?.environment.capabilities
    : undefined;
  const selected = useMainViewStore((state) =>
    selectThreadMainPullRequest(state.pullRequestByThreadKey, threadRef),
  );
  return useMemo(
    () => resolveThreadMainPullRequest({ threadRef, thread, projects, capabilities, selected }),
    [threadRef, thread, projects, capabilities, selected],
  );
}
