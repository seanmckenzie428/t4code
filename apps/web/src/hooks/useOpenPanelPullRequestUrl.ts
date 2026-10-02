import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import {
  readPullRequestDetailSnapshot,
  resolveDisplayedPullRequestDetail,
  resolvePullRequestReferenceHost,
} from "../components/pullRequest/pullRequestDetail.logic";
import { gitHubPullRequestBrowserUrl } from "../lib/openPullRequestLink";
import {
  selectThreadMainPullRequest,
  selectThreadMainView,
  useMainViewStore,
} from "../mainViewStore";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { useProject } from "../state/entities";
import { pullRequestEnvironment } from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";
import { useSupportsMultiplePullRequests } from "./useSupportsMultiplePullRequests";

export function useOpenPanelPullRequestUrl(threadRef: ScopedThreadRef | null) {
  const standalone =
    threadRef?.environmentId === PULL_REQUESTS_PANEL_REF.environmentId &&
    threadRef.threadId === PULL_REQUESTS_PANEL_REF.threadId;
  const panelSurface = useRightPanelStore((state) =>
    standalone ? selectActiveRightPanelSurface(state.byThreadKey, threadRef) : null,
  );
  const mainSurface = useMainViewStore((state) => {
    if (standalone) return null;
    const activeView = selectThreadMainView(state.byThreadKey, threadRef);
    return activeView === "pull-request"
      ? selectThreadMainPullRequest(state.pullRequestByThreadKey, threadRef)
      : null;
  });
  const surface = standalone ? panelSurface : mainSurface;
  const requestedReference = surface?.kind === "pull-request" ? surface : null;
  const environmentId = requestedReference?.environmentId
    ? EnvironmentId.make(requestedReference.environmentId)
    : threadRef?.environmentId;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(environmentId ?? null);
  const project = useProject(
    requestedReference && environmentId
      ? scopeProjectRef(environmentId, ProjectId.make(requestedReference.projectId))
      : null,
  );
  const reference = useMemo(() => {
    if (requestedReference === null) return null;
    const input = {
      projectId: ProjectId.make(requestedReference.projectId),
      repository: requestedReference.repository,
      number: requestedReference.number,
    };
    return supportsMultiplePullRequests
      ? resolvePullRequestReferenceHost(
          {
            ...input,
            ...(requestedReference.host === undefined ? {} : { host: requestedReference.host }),
          },
          project?.repositoryIdentity,
        )
      : input;
  }, [requestedReference, supportsMultiplePullRequests, project?.repositoryIdentity]);
  const detail = useEnvironmentQuery(
    reference && environmentId
      ? pullRequestEnvironment.detail({
          environmentId,
          input: reference,
        })
      : null,
  ).data;
  const cachedDetail = useMemo(
    () =>
      reference && environmentId
        ? readPullRequestDetailSnapshot(
            typeof window === "undefined" ? undefined : window.localStorage,
            environmentId,
            reference,
          )
        : null,
    [environmentId, reference],
  );
  return reference
    ? (resolveDisplayedPullRequestDetail({ live: detail, cached: cachedDetail, reference })?.url ??
        requestedReference?.url ??
        gitHubPullRequestBrowserUrl(
          project?.repositoryIdentity,
          reference.repository,
          reference.number,
        ))
    : undefined;
}
