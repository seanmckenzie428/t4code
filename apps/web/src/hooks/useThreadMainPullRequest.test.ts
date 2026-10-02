import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestSurface } from "../rightPanelStore";
import { resolveThreadMainPullRequest } from "./useThreadMainPullRequest";

const environmentId = EnvironmentId.make("local");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread"));
const projectId = ProjectId.make("project");
const capabilities = { pullRequests: true, threadPullRequests: true };

function project(
  id = projectId,
  environment = environmentId,
  repository = "owner/repo",
): EnvironmentProject {
  return {
    id,
    environmentId: environment,
    kind: "workspace",
    title: "Project",
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: {
      canonicalKey: `github.com/${repository}`,
      provider: "github",
      displayName: repository,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://github.com/${repository}.git`,
      },
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };
}

function link(
  number: number,
  overrides: Partial<ThreadPullRequestLink> = {},
): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "owner/repo",
    number,
    url: `https://github.com/owner/repo/pull/${number}`,
    source: "agent",
    linkedAt: "2026-10-02T00:00:00.000Z",
    snapshot: null,
    stack: null,
    ...overrides,
  };
}

const first = link(12);
const second = link(34);
const firstSurface = pullRequestSurface({
  projectId,
  host: first.host,
  repository: first.repository,
  number: first.number,
  url: first.url,
});
const input = {
  threadRef,
  thread: { projectId, pullRequests: [first, second] },
  projects: [project()],
  capabilities,
  selected: null,
};

describe("resolveThreadMainPullRequest", () => {
  it("opens the first visible link for a default or persisted null selection", () => {
    expect(
      resolveThreadMainPullRequest({
        ...input,
        thread: {
          ...input.thread,
          pullRequests: [link(99, { source: "stack-dismissed" }), first, second],
          linkedPullRequest: { projectId, ...second },
        },
      }),
    ).toEqual(firstSurface);
  });

  it("follows the next first link after unlinking without remembering the previous default", () => {
    expect(resolveThreadMainPullRequest(input)).toEqual(firstSurface);
    expect(
      resolveThreadMainPullRequest({
        ...input,
        thread: { ...input.thread, pullRequests: [second] },
      }),
    ).toMatchObject({ number: second.number, url: second.url });
  });

  it("preserves an explicitly opened PR even when it is not linked to the thread", () => {
    const selected = pullRequestSurface({ projectId, repository: "other/repo", number: 56 });
    expect(resolveThreadMainPullRequest({ ...input, selected })).toBe(selected);
    expect(
      resolveThreadMainPullRequest({ ...input, selected, thread: null, capabilities: undefined }),
    ).toBe(selected);
  });

  it("selects the thread's own checkout before another checkout of the same repository", () => {
    expect(
      resolveThreadMainPullRequest({
        ...input,
        projects: [project(ProjectId.make("duplicate")), project()],
      }),
    ).toEqual(firstSurface);
  });

  it("uses a same-environment checkout for the linked repository before borrowing host credentials", () => {
    const otherProjectId = ProjectId.make("other-project");
    const otherLink = link(45, {
      repository: "owner/other",
      url: "https://github.com/owner/other/pull/45",
    });
    const otherInput = {
      ...input,
      thread: { projectId, pullRequests: [otherLink] },
    };
    expect(
      resolveThreadMainPullRequest({
        ...otherInput,
        projects: [project(), project(otherProjectId, environmentId, "owner/other")],
      }),
    ).toMatchObject({ projectId: otherProjectId, repository: "owner/other", number: 45 });
    expect(resolveThreadMainPullRequest(otherInput)).toMatchObject({
      projectId,
      repository: "owner/other",
      number: 45,
    });
    expect(
      resolveThreadMainPullRequest({
        ...otherInput,
        projects: [project(otherProjectId, EnvironmentId.make("remote"), "owner/other")],
      }),
    ).toBeNull();
  });

  it("does not skip an unresolvable first link to open a different linked PR", () => {
    expect(
      resolveThreadMainPullRequest({
        ...input,
        thread: {
          projectId,
          pullRequests: [
            link(98, {
              host: "github.enterprise.test",
              url: "https://github.enterprise.test/owner/repo/pull/98",
            }),
            first,
          ],
        },
      }),
    ).toBeNull();
  });

  it("preserves Forgejo HTTP authority when resolving the first link", () => {
    const forgejo: EnvironmentProject = {
      ...project(),
      repositoryIdentity: {
        canonicalKey: "forge.example/team/repo",
        provider: "forgejo",
        displayName: "team/repo",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "http://forge.example:4000/team/repo.git",
        },
      },
    };
    const forgeLink = link(7, {
      host: "forge.example",
      repository: "team/repo",
      url: "http://forge.example:4000/team/repo/pulls/7",
    });
    expect(
      resolveThreadMainPullRequest({
        ...input,
        projects: [forgejo],
        thread: { projectId, pullRequests: [forgeLink] },
      }),
    ).toMatchObject({ host: "forge.example:4000", repository: "team/repo", number: 7 });
  });

  it("waits for detail capability and respects servers without thread link lists", () => {
    expect(resolveThreadMainPullRequest({ ...input, capabilities: undefined })).toBeNull();
    expect(
      resolveThreadMainPullRequest({
        ...input,
        capabilities: { ...capabilities, pullRequests: false },
      }),
    ).toBeNull();
    expect(
      resolveThreadMainPullRequest({
        ...input,
        capabilities: { ...capabilities, threadPullRequests: false },
      }),
    ).toBeNull();
    const legacy = {
      projectId,
      repository: second.repository,
      number: second.number,
      url: second.url,
    };
    expect(
      resolveThreadMainPullRequest({
        ...input,
        capabilities: { ...capabilities, threadPullRequests: false },
        thread: { ...input.thread, linkedPullRequest: legacy },
      }),
    ).toEqual(pullRequestSurface(legacy));
  });

  it("falls back to legacy linked then branch PRs when there are no visible links", () => {
    const legacy = {
      projectId,
      repository: first.repository,
      number: first.number,
      url: first.url,
    };
    const branch = { ...legacy, number: second.number, url: second.url };
    expect(
      resolveThreadMainPullRequest({
        ...input,
        thread: {
          projectId,
          pullRequests: [],
          linkedPullRequest: legacy,
          branchPullRequest: branch,
        },
      }),
    ).toEqual(pullRequestSurface(legacy));
    expect(
      resolveThreadMainPullRequest({
        ...input,
        thread: { projectId, pullRequests: [], branchPullRequest: branch },
      }),
    ).toEqual(pullRequestSurface(branch));
    expect(resolveThreadMainPullRequest({ ...input, threadRef: null })).toBeNull();
  });
});
