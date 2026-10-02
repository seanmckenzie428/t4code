import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import type { AppControlThread as OrchestrationThread } from "./AppControlState.ts";
type OrchestrationReadModel = { readonly threads: ReadonlyArray<OrchestrationThread> };

import {
  MAX_CONCURRENT_ASSISTANT_DELEGATIONS,
  activeDelegatedTurnCount,
  delegationOriginThreadId,
  validateDelegationPrincipal,
  validateDelegationTarget,
} from "./AppControlDelegation.ts";

const assistantThreadId = ThreadId.make("assistant-1");
const principal = { kind: "global-assistant" as const, assistantThreadId };

const delegatedThread = (id: string, state: "running" | "completed" = "running") =>
  ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("project-1"),
    kind: "project",
    deletedAt: null,
    session:
      state === "running"
        ? { status: "running", activeTurnId: "turn-1" }
        : { status: "ready", activeTurnId: null },
    latestTurn: state === "completed" ? { requestedAt: "2026-01-02" } : null,
    messages: [
      {
        role: "user",
        turnId: null,
        createdAt: "2026-01-01",
        delegation: { assistantThreadId, actionId: `action-${id}`, depth: 1 },
      },
    ],
  }) as unknown as OrchestrationThread;

it("allows regular chats but rejects delegated threads from delegating again", () => {
  const regularPrincipal = {
    kind: "thread-agent" as const,
    threadId: ThreadId.make("regular-1"),
    projectId: ProjectId.make("project-1"),
  };
  const regularSource = {
    ...delegatedThread("regular-1"),
    messages: [{ role: "user", createdAt: "2026-01-01", delegation: undefined }],
  } as unknown as OrchestrationThread;
  expect(
    validateDelegationPrincipal({ principal: regularPrincipal, source: regularSource }),
  ).toBeUndefined();
  expect(
    validateDelegationPrincipal({
      principal: {
        kind: "thread-agent",
        threadId: ThreadId.make("delegated-1"),
        projectId: ProjectId.make("project-1"),
      },
      source: delegatedThread("delegated-1"),
    }),
  ).toContain("cannot delegate");
  expect(delegationOriginThreadId(regularPrincipal)).toBe(regularPrincipal.threadId);
});

it("rejects assistant and self targets", () => {
  const target = { ...delegatedThread("target"), kind: "assistant" as const };
  expect(validateDelegationTarget({ principal, target })).toContain("cannot delegate");
});

it("counts only active assistant-originated turns", () => {
  const snapshot = {
    threads: [
      delegatedThread("one"),
      delegatedThread("two"),
      delegatedThread("three"),
      delegatedThread("done", "completed"),
    ],
  } as unknown as OrchestrationReadModel;
  expect(activeDelegatedTurnCount(snapshot, assistantThreadId)).toBe(
    MAX_CONCURRENT_ASSISTANT_DELEGATIONS,
  );
});

it("requires an active target before stopping", () => {
  expect(
    validateDelegationTarget({
      principal,
      target: delegatedThread("done", "completed"),
      requireActive: true,
    }),
  ).toContain("not active");
});
