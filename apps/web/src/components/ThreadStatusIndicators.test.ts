import {
  EnvironmentId,
  ProjectId,
  ThreadPullRequestLink,
  type PullRequestSummary,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { act, createElement, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ChangeRequestStatusIcon,
  linkedPullRequestSnapshotStatus,
  useLinkedThreadPullRequest,
  type LinkedThreadPullRequestStatus,
  prStatusIndicator,
  resolveThreadPullRequestBadgePresentation,
} from "./ThreadStatusIndicators";
import { newestPullRequestSummary } from "../state/pullRequests";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { changeRequestAutoSettles } from "@t3tools/client-runtime/state/thread-settled";

vi.mock("~/hooks/useSupportsMultiplePullRequests", () => ({
  useSupportsMultiplePullRequests: () => true,
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../state/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/pullRequests")>()),
  useSharedPullRequestSummary: () => null,
}));

const decodeThreadPullRequestLink = Schema.decodeUnknownSync(ThreadPullRequestLink);

function durableLink(number: number, state: "open" | "closed" | "merged"): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "pingdotgg/t3code",
    number,
    url: `https://github.com/pingdotgg/t3code/pull/${number}`,
    source: "manual",
    linkedAt: "2026-09-01T00:00:00.000Z",
    stack: null,
    snapshot: {
      state,
      title: "Feature PR",
      headBranch: "feature/current",
      baseBranch: "main",
      isDraft: false,
      updatedAt: "2026-09-03T01:00:00.000Z",
      syncedAt: "2026-09-03T01:00:00.000Z",
    },
  };
}

describe("persisted linked pull request status", () => {
  it.each(["closed", "merged"] as const)(
    "restores a %s snapshot after serialization without VCS data",
    (state) => {
      const restored = decodeThreadPullRequestLink(
        JSON.parse(JSON.stringify(durableLink(42, state))),
      );
      expect(linkedPullRequestSnapshotStatus(restored)).toMatchObject({
        pr: { number: 42, state, headRef: "feature/current", baseRef: "main" },
        sourceControlProvider: { kind: "github" },
      });
    },
  );

  it.each(["closed", "merged"] as const)(
    "keeps a linked %s PR active when automatic settlement is disabled",
    (state) => {
      const status = linkedPullRequestSnapshotStatus(durableLink(42, state));
      expect(status).not.toBeNull();
      expect(changeRequestAutoSettles(status!.pr, { autoSettleAfterDays: null })).toBe(false);
    },
  );

  it("retains linked identity through branch changes and remounts, then clears replaced or removed links", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    let observed: LinkedThreadPullRequestStatus | null = null;
    const environmentId = EnvironmentId.make("environment-1");
    const linked = durableLink(42, "merged");
    const unrelatedBranchPr = {
      projectId: ProjectId.make("project-1"),
      repository: "pingdotgg/t3code",
      number: 99,
      url: "https://github.com/pingdotgg/t3code/pull/99",
    };
    function Status({
      links,
      branchPr,
    }: {
      links: ReadonlyArray<ThreadPullRequestLink>;
      branchPr?: typeof unrelatedBranchPr;
    }) {
      const status = useLinkedThreadPullRequest(environmentId, null, true, links, branchPr);
      useEffect(() => {
        observed = status;
      }, [status]);
      return null;
    }
    try {
      await act(async () => {
        renderer = create(createElement(Status, { links: [linked] }));
      });
      expect(observed).toMatchObject({ pr: { number: 42, state: "merged" } });
      await act(async () => {
        renderer!.update(createElement(Status, { links: [linked], branchPr: unrelatedBranchPr }));
      });
      expect(observed).toMatchObject({
        pr: { number: 42, state: "merged", headRef: "feature/current" },
      });
      await act(async () => renderer!.unmount());
      await act(async () => {
        renderer = create(createElement(Status, { links: [linked] }));
      });
      expect(observed).toMatchObject({ pr: { number: 42, state: "merged" } });

      // A new unsynced identity must not inherit the preceding PR's terminal state.
      const replacement = { ...durableLink(43, "open"), snapshot: null };
      await act(async () => {
        renderer!.update(createElement(Status, { links: [replacement] }));
      });
      expect(observed).toBeNull();
      await act(async () => {
        renderer!.update(createElement(Status, { links: [durableLink(43, "open")] }));
      });
      expect(observed).toMatchObject({ pr: { number: 43, state: "open" } });
      await act(async () => {
        renderer!.update(createElement(Status, { links: [] }));
      });
      expect(observed).toBeNull();
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});

describe("ChangeRequestStatusIcon", () => {
  it.each([
    ["open", "open", false, PullRequestGlyph.pullRequest],
    ["draft", "open", true, PullRequestGlyph.draft],
    ["closed", "closed", false, PullRequestGlyph.closed],
    ["merged", "merged", false, PullRequestGlyph.merged],
  ] as const)("uses the %s pull request glyph", (_label, state, isDraft, expectedIcon) => {
    expect(ChangeRequestStatusIcon({ state, isDraft }).type).toBe(expectedIcon);
  });
});

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/current",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "PR branch",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      baseRef: "main",
      headRef: "feature/current",
      state: "open",
    },
    ...overrides,
  };
}

function pullRequestSummary(
  state: PullRequestSummary["state"],
  updatedAt: string,
): PullRequestSummary {
  return {
    provider: "github",
    projectId: ProjectId.make("project-1"),
    repository: "pingdotgg/t3code",
    number: 42,
    title: "Feature PR",
    url: "https://github.com/pingdotgg/t3code/pull/42",
    state,
    headBranch: "feature/current",
    baseBranch: "main",
    updatedAt,
  };
}

describe("shared pull request state", () => {
  it("shows a panel-observed merge instead of an older sidebar summary", () => {
    const open = pullRequestSummary("open", "2026-09-03T01:00:00.000Z");
    const merged = pullRequestSummary("merged", "2026-09-03T01:01:00.000Z");

    expect(newestPullRequestSummary(open, merged)).toBe(merged);
  });

  it("never lets a stale open response regress a merged observation", () => {
    const merged = pullRequestSummary("merged", "2026-09-03T01:01:00.000Z");
    const staleOpen = pullRequestSummary("open", "2026-09-03T01:00:00.000Z");

    expect(newestPullRequestSummary(merged, staleOpen)).toBe(merged);
  });

  it("accepts a newer open state after a closed pull request is reopened", () => {
    const closed = pullRequestSummary("closed", "2026-09-03T01:00:00.000Z");
    const reopened = pullRequestSummary("open", "2026-09-03T01:01:00.000Z");

    expect(newestPullRequestSummary(closed, reopened)).toBe(reopened);
  });
});

describe("prStatusIndicator", () => {
  it("formats PR tooltips with number, uppercase status, and title", () => {
    expect(prStatusIndicator(status().pr, undefined)).toMatchObject({
      tooltip: "PR #42 - Open: PR branch",
      tooltipLead: "PR #42 - Open",
      tooltipTitle: "PR branch",
    });
  });

  it("uses red for closed pull requests", () => {
    const closedPr = status().pr;
    if (!closedPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...closedPr, state: "closed" }, undefined)?.colorClass).toContain(
      "text-red-600",
    );
  });

  it("uses gray and draft wording for draft pull requests", () => {
    const draftPr = status().pr;
    if (!draftPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...draftPr, isDraft: true }, undefined)).toMatchObject({
      label: "PR draft",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltipLead: "PR #42 - Draft",
    });
  });
});

describe("resolveThreadPullRequestBadgePresentation", () => {
  const url = "https://github.com/pingdotgg/t3code/pull/42";

  it("returns the pending pull-request badge when no snapshot is available", () => {
    expect(
      resolveThreadPullRequestBadgePresentation({
        badge: null,
        number: 42,
        url,
        status: null,
      }),
    ).toEqual({
      Icon: PullRequestGlyph.pullRequest,
      toneClassName: "text-muted-foreground",
      label: "PR #42, status pending",
      text: 42,
    });
  });

  it.each([
    [
      "open",
      { state: "open", isDraft: false },
      PullRequestGlyph.pullRequest,
      "text-emerald-600 dark:text-emerald-300/90",
      "PR #42 - Open: PR branch",
    ],
    [
      "draft",
      { state: "open", isDraft: true },
      PullRequestGlyph.draft,
      "text-zinc-500 dark:text-zinc-400/80",
      "PR #42 - Draft: PR branch",
    ],
    [
      "closed",
      { state: "closed", isDraft: false },
      PullRequestGlyph.closed,
      "text-red-600 dark:text-red-300/90",
      "PR #42 - Closed: PR branch",
    ],
    [
      "merged",
      { state: "merged", isDraft: false },
      PullRequestGlyph.merged,
      "text-violet-600 dark:text-violet-300/90",
      "PR #42 - Merged: PR branch",
    ],
  ] as const)(
    "keeps the %s state for one linked pull request",
    (_state, prOverrides, expectedIcon, expectedToneClassName, expectedLabel) => {
      const fixture = status().pr;
      if (!fixture) throw new Error("Expected pull request fixture");
      const prStatus = prStatusIndicator({ ...fixture, ...prOverrides }, undefined);
      if (!prStatus) throw new Error("Expected pull request status");

      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "pull-request", others: 0, state: "open" },
          number: fixture.number,
          url: fixture.url,
          status: prStatus,
        }),
      ).toEqual({
        Icon: expectedIcon,
        toneClassName: expectedToneClassName,
        label: expectedLabel,
        text: fixture.number,
      });
    },
  );

  it.each([
    ["open", "text-emerald-600 dark:text-emerald-300/90"],
    ["draft", "text-zinc-500 dark:text-zinc-400/80"],
    ["merged", "text-violet-600 dark:text-violet-300/90"],
  ] as const)(
    "uses a layers badge with the %s stack tone without a link identity",
    (state, expectedToneClassName) => {
      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "stack", layers: 3, state },
          status: null,
        }),
      ).toEqual({
        Icon: PullRequestGlyph.stack,
        toneClassName: expectedToneClassName,
        label: `Stack of 3 pull requests, ${state}`,
        text: 3,
      });
    },
  );

  it.each([
    ["open", PullRequestGlyph.pullRequest, "text-emerald-600 dark:text-emerald-300/90"],
    ["draft", PullRequestGlyph.draft, "text-zinc-500 dark:text-zinc-400/80"],
    ["merged", PullRequestGlyph.merged, "text-violet-600 dark:text-violet-300/90"],
  ] as const)(
    "draws the count of unrelated linked pull requests with their %s aggregate state",
    (state, expectedIcon, expectedToneClassName) => {
      const fixture = status().pr;
      if (!fixture) throw new Error("Expected pull request fixture");
      const closedStatus = prStatusIndicator(
        { ...fixture, state: "closed", isDraft: false },
        undefined,
      );
      if (!closedStatus) throw new Error("Expected pull request status");

      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "pull-request", others: 2, state },
          number: fixture.number,
          url: fixture.url,
          status: closedStatus,
        }),
      ).toEqual({
        Icon: expectedIcon,
        toneClassName: expectedToneClassName,
        label: `PR #42 - Closed: PR branch, and 2 more linked; overall ${state}`,
        text: "+3",
      });
    },
  );

  it("omits the control when neither a stack nor a linked identity can be shown", () => {
    expect(resolveThreadPullRequestBadgePresentation({ badge: null, status: null })).toBeNull();
  });
});
