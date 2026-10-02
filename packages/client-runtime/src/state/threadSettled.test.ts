import { ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type ChangeRequestStateLike,
  changeRequestAutoSettles,
  effectiveSettled,
  hasQueuedTurnStart,
  threadLastActivityAt,
} from "./threadSettled.ts";

type OrchestrationThreadShell = Parameters<typeof effectiveSettled>[0] & { id: ThreadId };

const NOW = "2026-04-10T00:00:00.000Z";
const FRESH = "2026-04-09T00:00:00.000Z";
const STALE = "2026-04-06T23:59:59.999Z";

describe("changeRequestAutoSettles", () => {
  it.each([
    ["open", 3, true, false],
    ["merged", 3, true, true],
    ["merged", 3, false, false],
    ["closed", 3, false, true],
    ["closed", null, true, false],
    [null, 3, false, false],
  ] as const)(
    "state=%s autoSettleAfterDays=%s autoSettleOnMerge=%s returns %s",
    (state, autoSettleAfterDays, autoSettleOnMerge, expected) => {
      expect(
        changeRequestAutoSettles(state === null ? null : { state }, {
          autoSettleAfterDays,
          autoSettleOnMerge,
        }),
      ).toBe(expected);
    },
  );

  const THREAD_CREATED_AT = "2026-04-01T00:00:00.000Z";
  const idleThread = {
    createdAt: THREAD_CREATED_AT,
    latestUserMessageAt: null,
    latestTurn: null,
  };

  it("ignores a terminal change request last touched before the thread existed", () => {
    for (const state of ["merged", "closed"] as const) {
      expect(
        changeRequestAutoSettles(
          { state, updatedAt: "2026-03-31T23:59:59.999Z" },
          { thread: idleThread },
        ),
      ).toBe(false);
    }
  });

  it("settles on a terminal change request touched at or after the thread's latest event", () => {
    for (const updatedAt of [THREAD_CREATED_AT, "2026-04-02T00:00:00.000Z"]) {
      expect(changeRequestAutoSettles({ state: "merged", updatedAt }, { thread: idleThread })).toBe(
        true,
      );
    }
  });

  it("never re-settles a thread revived after the merge", () => {
    // Settling on a merge happens once: a user message newer than the PR's
    // last activity means the conversation outlived the PR.
    const revived = {
      createdAt: THREAD_CREATED_AT,
      latestUserMessageAt: "2026-04-05T00:00:00.000Z",
      latestTurn: null,
    };
    expect(
      changeRequestAutoSettles(
        { state: "merged", updatedAt: "2026-04-03T00:00:00.000Z" },
        { thread: revived },
      ),
    ).toBe(false);
    // A merge landing after the revival still settles.
    expect(
      changeRequestAutoSettles(
        { state: "merged", updatedAt: "2026-04-06T00:00:00.000Z" },
        { thread: revived },
      ),
    ).toBe(true);
  });

  it("still settles when the merge lands during an in-flight turn", () => {
    // Anchor is user-initiated activity only: the agent finishing a turn
    // after the merge must not block the settle the merge earned.
    const midTurnMerge = {
      createdAt: THREAD_CREATED_AT,
      latestUserMessageAt: "2026-04-02T00:00:00.000Z",
      latestTurn: {
        turnId: TurnId.make("turn-mid"),
        state: "completed" as const,
        requestedAt: "2026-04-02T00:00:00.000Z",
        startedAt: "2026-04-02T00:00:05.000Z",
        completedAt: "2026-04-02T00:20:00.000Z",
        assistantMessageId: null,
      },
    };
    expect(
      changeRequestAutoSettles(
        { state: "merged", updatedAt: "2026-04-02T00:10:00.000Z" },
        { thread: midTurnMerge },
      ),
    ).toBe(true);
  });

  it("falls back to settling when either timestamp is missing or malformed", () => {
    expect(changeRequestAutoSettles({ state: "merged" }, { thread: idleThread })).toBe(true);
    expect(
      changeRequestAutoSettles({ state: "merged", updatedAt: null }, { thread: idleThread }),
    ).toBe(true);
    expect(
      changeRequestAutoSettles({ state: "merged", updatedAt: "2026-03-01T00:00:00.000Z" }, {}),
    ).toBe(true);
    expect(
      changeRequestAutoSettles(
        { state: "merged", updatedAt: "not-a-date" },
        { thread: idleThread },
      ),
    ).toBe(true);
  });
});

function makeShell(input: {
  readonly settledOverride?: "settled" | "active" | null;
  readonly activityAt: string | null;
  readonly sessionStatus?: "starting" | "running";
  readonly pending?: "approval" | "user-input";
}) {
  const threadId = ThreadId.make("thread-1");
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    latestTurn:
      input.activityAt === null
        ? null
        : {
            turnId: TurnId.make("turn-1"),
            state: "completed" as const,
            requestedAt: input.activityAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledOverride === "settled" ? NOW : null,
    settledSince: null,
    archiveLifecycle: null,
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access" as const,
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
    pullRequests: [],
    latestUserMessageAt: null,
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    hasActionableProposedPlan: false,
  };
}

describe("threadLastActivityAt", () => {
  it("returns the latest real user or turn activity and ignores thread/session updates", () => {
    const shell = makeShell({ activityAt: null, sessionStatus: "running" });
    const withActivity: OrchestrationThreadShell = {
      ...shell,
      latestUserMessageAt: "2026-04-04T00:00:00.000Z",
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-04-03T00:00:00.000Z",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-06T00:00:00.000Z",
        assistantMessageId: null,
      },
    };

    expect(threadLastActivityAt(withActivity)).toBe("2026-04-06T00:00:00.000Z");
    expect(threadLastActivityAt(shell)).toBeNull();
  });
});

describe("effectiveSettled", () => {
  const overrideCases = [null, "settled", "active"] as const;
  const changeRequestStates = [undefined, "open", "merged"] as const;
  const inactivityCases = [
    ["fresh", FRESH],
    ["stale", STALE],
    ["no-activity", null],
  ] as const;
  const runningCases = [false, true] as const;
  const pendingCases = [undefined, "approval", "user-input"] as const;
  const truthTable = overrideCases.flatMap((settledOverride) =>
    changeRequestStates.flatMap((changeRequestState) =>
      inactivityCases.flatMap(([inactivity, activityAt]) =>
        runningCases.flatMap((running) =>
          pendingCases.map((pending) => ({
            settledOverride,
            changeRequestState,
            inactivity,
            activityAt,
            running,
            pending,
            // Settled iff nothing blocks (pending work / live session) AND
            // the override says settled, or (with no override) a merged PR
            // or staleness auto-settles. The "active" pin suppresses both
            // auto signals, and an open PR suppresses the inactivity path:
            // a thread with a PR out for review is never done, however quiet.
            expected:
              pending === undefined &&
              !running &&
              (settledOverride === "settled" ||
                (settledOverride === null &&
                  (changeRequestState === "merged" ||
                    (changeRequestState !== "open" && inactivity === "stale")))),
          })),
        ),
      ),
    ),
  );

  it.each(truthTable)(
    "override=$settledOverride pr=$changeRequestState inactivity=$inactivity running=$running pending=$pending",
    ({ settledOverride, changeRequestState, activityAt, running, pending, expected }) => {
      const shell = makeShell({
        settledOverride,
        activityAt,
        ...(running ? { sessionStatus: "running" as const } : {}),
        ...(pending === undefined ? {} : { pending }),
      });
      const changeRequestOptions =
        changeRequestState === undefined
          ? {}
          : { changeRequest: { state: changeRequestState as ChangeRequestStateLike } };

      expect(
        effectiveSettled(shell, {
          now: NOW,
          autoSettleAfterDays: 3,
          ...changeRequestOptions,
        }),
      ).toBe(expected);
    },
  );

  it("keeps completed change requests active when automatic settlement is off", () => {
    const shell = makeShell({ activityAt: null });
    for (const changeRequestState of ["merged", "closed"] as const) {
      expect(
        effectiveSettled(shell, {
          now: NOW,
          autoSettleAfterDays: null,
          changeRequest: { state: changeRequestState },
        }),
      ).toBe(false);
    }
  });

  it("settles immediately when enabled and a change request merges or closes", () => {
    const recentlyActive = makeShell({ activityAt: "2026-04-09T23:59:59.999Z" });
    for (const changeRequestState of ["merged", "closed"] as const) {
      expect(
        effectiveSettled(recentlyActive, {
          now: NOW,
          autoSettleAfterDays: 3,
          changeRequest: { state: changeRequestState },
        }),
      ).toBe(true);
    }
  });

  it("keeps explicit settlement authoritative when automation is off", () => {
    const shell = makeShell({ settledOverride: "settled", activityAt: FRESH });
    expect(
      effectiveSettled(shell, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequest: { state: "merged" },
      }),
    ).toBe(true);
  });

  it("ignores a change request that merged before the thread's latest event", () => {
    // A new thread started at a worktree root inherits the branch's old
    // merged PR, and a revived thread outlives its merge; neither settles
    // the live conversation.
    const fresh = makeShell({ activityAt: FRESH });
    for (const state of ["merged", "closed"] as const) {
      expect(
        effectiveSettled(fresh, {
          now: NOW,
          autoSettleAfterDays: 3,
          changeRequest: { state, updatedAt: "2026-03-20T00:00:00.000Z" },
        }),
      ).toBe(false);
    }
    // A merge during the thread's life still settles it.
    expect(
      effectiveSettled(fresh, {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequest: { state: "merged", updatedAt: "2026-04-09T00:00:00.000Z" },
      }),
    ).toBe(true);
  });

  it("can keep a merged change request active", () => {
    const recentlyActive = makeShell({ activityAt: "2026-04-09T23:59:59.999Z" });
    expect(
      effectiveSettled(recentlyActive, {
        now: NOW,
        autoSettleAfterDays: 3,
        autoSettleOnMerge: false,
        changeRequest: { state: "merged" },
      }),
    ).toBe(false);

    expect(
      effectiveSettled(recentlyActive, {
        now: NOW,
        autoSettleAfterDays: 3,
        autoSettleOnMerge: false,
        changeRequest: { state: "closed" },
      }),
    ).toBe(true);
  });

  it("never auto-settles a stale thread with an open change request", () => {
    const stale = makeShell({ activityAt: STALE });
    expect(
      effectiveSettled(stale, {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequest: { state: "open" },
      }),
    ).toBe(false);
    // An explicit user settle still wins: open PR only blocks the auto path.
    const settled = makeShell({ settledOverride: "settled", activityAt: STALE });
    expect(
      effectiveSettled(settled, {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequest: { state: "open" },
      }),
    ).toBe(true);
  });

  it("keeps an explicitly un-settled merged-PR thread active", () => {
    const shell = makeShell({
      settledOverride: "active",
      activityAt: "2026-04-09T23:59:59.999Z",
    });
    expect(
      effectiveSettled(shell, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequest: { state: "merged" },
      }),
    ).toBe(false);
  });

  it("never settles a starting session, even with a settled override", () => {
    const shell = makeShell({
      settledOverride: "settled",
      activityAt: STALE,
      sessionStatus: "starting",
    });
    expect(
      effectiveSettled(shell, {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequest: { state: "merged" },
      }),
    ).toBe(false);
  });

  it("keeps a new turn active from queued through starting and running", () => {
    const requestedAt = "2026-04-09T12:00:00.000Z";
    const transitionNow = "2026-04-09T12:00:30.000Z";
    const base = makeShell({
      settledOverride: null,
      activityAt: STALE,
    });
    const queued: OrchestrationThreadShell = {
      ...base,
      latestUserMessageAt: requestedAt,
      latestTurn: null,
      session: null,
    };
    const starting: OrchestrationThreadShell = {
      ...queued,
      session: {
        threadId: queued.id,
        status: "starting",
        providerName: "Codex",
        runtimeMode: "full-access" as const,
        activeTurnId: null,
        lastError: null,
        updatedAt: requestedAt,
      },
    };
    const running: OrchestrationThreadShell = {
      ...starting,
      session: {
        ...starting.session!,
        status: "running",
        activeTurnId: TurnId.make("turn-new"),
      },
    };

    for (const shell of [queued, starting, running]) {
      expect(
        effectiveSettled(shell, {
          now: transitionNow,
          autoSettleAfterDays: 3,
          changeRequest: { state: "merged" },
        }),
      ).toBe(false);
    }
  });

  it("uses a strict inactivity boundary and honors a null threshold", () => {
    const boundary = makeShell({
      activityAt: "2026-04-07T00:00:00.000Z",
    });
    const stale = makeShell({ activityAt: STALE });

    expect(effectiveSettled(boundary, { now: NOW, autoSettleAfterDays: 3 })).toBe(false);
    expect(effectiveSettled(stale, { now: NOW, autoSettleAfterDays: null })).toBe(false);
  });
});

describe("changeRequestAutoSettles", () => {
  it("uses the automatic settlement preference as the master switch", () => {
    expect(changeRequestAutoSettles("merged", null)).toBe(false);
    expect(changeRequestAutoSettles("closed", null)).toBe(false);
    expect(changeRequestAutoSettles("merged", 3)).toBe(true);
    expect(changeRequestAutoSettles("closed", 3)).toBe(true);
    expect(changeRequestAutoSettles("open", 3)).toBe(false);
  });
});
describe("hasQueuedTurnStart", () => {
  const QUEUED_AT = "2026-04-09T12:00:00.000Z";
  // Within the adoption grace window of the queued message.
  const JUST_AFTER = { now: "2026-04-09T12:00:30.000Z" };

  it("flags a user message no turn has picked up, within the grace window", () => {
    const noTurn = { latestUserMessageAt: QUEUED_AT, latestTurn: null, session: null };
    expect(hasQueuedTurnStart(noTurn, JUST_AFTER)).toBe(true);

    const staleTurn = {
      ...makeShell({ activityAt: FRESH }),
      latestUserMessageAt: QUEUED_AT,
    };
    expect(hasQueuedTurnStart(staleTurn, JUST_AFTER)).toBe(true);
  });

  it("expires after the grace window: an unadopted message is a failed start, not queued work", () => {
    const noTurn = { latestUserMessageAt: QUEUED_AT, latestTurn: null, session: null };
    expect(hasQueuedTurnStart(noTurn, { now: "2026-04-09T12:03:00.000Z" })).toBe(false);
    // Historical shells (e.g. from servers that never carried latestTurn)
    // must never read as queued.
    expect(hasQueuedTurnStart(noTurn, { now: NOW })).toBe(false);
  });

  it("clears once a turn adopts the message or the start fails", () => {
    const adopted = {
      ...makeShell({ activityAt: QUEUED_AT }),
      latestUserMessageAt: QUEUED_AT,
    };
    expect(hasQueuedTurnStart(adopted, JUST_AFTER)).toBe(false);

    const failed = makeShell({ activityAt: FRESH });
    const failedShell = {
      ...failed,
      latestUserMessageAt: QUEUED_AT,
      session: {
        threadId: failed.id,
        status: "error" as const,
        providerName: "Codex",
        runtimeMode: "full-access" as const,
        activeTurnId: null,
        lastError: "boom",
        updatedAt: NOW,
      },
    };
    expect(hasQueuedTurnStart(failedShell, JUST_AFTER)).toBe(false);
  });

  it("is quiet without user messages", () => {
    expect(hasQueuedTurnStart(makeShell({ activityAt: FRESH }), JUST_AFTER)).toBe(false);
  });

  it("bounds the grace window in both directions: a future-stamped message is skew, not queued work", () => {
    // Message timestamps originate on other devices; a clock an hour ahead
    // must not hold the queued state for the whole skew.
    const skewed = {
      latestUserMessageAt: "2026-04-09T13:00:00.000Z",
      latestTurn: null,
      session: null,
    };
    expect(hasQueuedTurnStart(skewed, { now: "2026-04-09T12:00:00.000Z" })).toBe(false);
    // A small negative age (within the grace window) still reads as queued.
    const slightlyAhead = {
      latestUserMessageAt: "2026-04-09T12:00:30.000Z",
      latestTurn: null,
      session: null,
    };
    expect(hasQueuedTurnStart(slightlyAhead, { now: "2026-04-09T12:00:00.000Z" })).toBe(true);
  });
});
