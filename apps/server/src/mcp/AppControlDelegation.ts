import type { AppControlPrincipal, ThreadId } from "@t3tools/contracts";
import type { AppControlThread } from "./AppControlState.ts";

export const MAX_CONCURRENT_ASSISTANT_DELEGATIONS = 3;

function latestDelegatedMessage(thread: AppControlThread) {
  return thread.messages.findLast(
    (message) => message.role === "user" && message.delegation !== undefined,
  );
}

function latestUserMessage(thread: AppControlThread) {
  return thread.messages.findLast((message) => message.role === "user");
}

export function isActiveDelegatedTurn(
  thread: AppControlThread,
  assistantThreadId: ThreadId,
): boolean {
  const message = latestDelegatedMessage(thread);
  if (message?.delegation?.assistantThreadId !== assistantThreadId) return false;
  if (thread.session?.status === "starting" || thread.session?.status === "running") return true;
  if (message.turnId !== null) return false;
  const latestTurnAt = thread.latestTurn?.requestedAt ?? "";
  return message.createdAt > latestTurnAt;
}

export function activeDelegatedTurnCount(
  snapshot: { readonly threads: ReadonlyArray<AppControlThread> },
  assistantThreadId: ThreadId,
): number {
  return snapshot.threads.filter(
    (thread) => thread.deletedAt === null && isActiveDelegatedTurn(thread, assistantThreadId),
  ).length;
}

export function delegationOriginThreadId(principal: AppControlPrincipal): ThreadId {
  return principal.kind === "thread-agent" ? principal.threadId : principal.assistantThreadId;
}

export function validateDelegationPrincipal(input: {
  readonly principal: AppControlPrincipal;
  readonly source?: AppControlThread | undefined;
}): string | undefined {
  if (input.principal.kind === "global-assistant")
    return "Quick Chat and assistant sessions are no longer supported.";
  if (input.source === undefined || input.source.deletedAt !== null) {
    return "Delegation source does not exist.";
  }
  return latestUserMessage(input.source)?.delegation === undefined
    ? undefined
    : "A delegated thread cannot delegate another turn.";
}

export function validateDelegationTarget(input: {
  readonly principal: AppControlPrincipal;
  readonly target: AppControlThread | undefined;
  readonly requireActive?: boolean;
}): string | undefined {
  const target = input.target;
  if (target === undefined || target.deletedAt !== null) return "Delegation target does not exist.";
  if (target.id === delegationOriginThreadId(input.principal) || target.kind === "assistant") {
    return "A chat cannot delegate to itself or a control thread.";
  }
  if (target.kind !== "project") return "Delegation target must be a project thread.";
  if (
    input.requireActive &&
    target.session?.status !== "starting" &&
    target.session?.status !== "running"
  ) {
    return "Delegated turn is not active.";
  }
  return undefined;
}
