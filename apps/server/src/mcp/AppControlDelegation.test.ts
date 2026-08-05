import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";

import {
  MAX_CONCURRENT_ASSISTANT_DELEGATIONS,
  activeDelegatedTurnCount,
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

it("rejects delegated threads from delegating again", () => {
  expect(
    validateDelegationPrincipal({
      kind: "thread-agent",
      threadId: ThreadId.make("delegated-1"),
      projectId: ProjectId.make("project-1"),
    }),
  ).toContain("only");
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
