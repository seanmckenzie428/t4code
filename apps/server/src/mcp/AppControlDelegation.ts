import type {
  AppControlPrincipal,
  OrchestrationReadModel,
  OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";

export const MAX_CONCURRENT_ASSISTANT_DELEGATIONS = 3;

function latestDelegatedMessage(thread: OrchestrationThread) {
  return thread.messages.findLast(
    (message) => message.role === "user" && message.delegation !== undefined,
  );
}

export function isActiveDelegatedTurn(
  thread: OrchestrationThread,
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
  snapshot: OrchestrationReadModel,
  assistantThreadId: ThreadId,
): number {
  return snapshot.threads.filter(
    (thread) => thread.deletedAt === null && isActiveDelegatedTurn(thread, assistantThreadId),
  ).length;
}

export function validateDelegationPrincipal(principal: AppControlPrincipal): string | undefined {
  return principal.kind === "global-assistant"
    ? undefined
    : "Delegation is available only to the environment's T3 Assistant.";
}

export function validateDelegationTarget(input: {
  readonly principal: Extract<AppControlPrincipal, { kind: "global-assistant" }>;
  readonly target: OrchestrationThread | undefined;
  readonly requireActive?: boolean;
}): string | undefined {
  const target = input.target;
  if (target === undefined || target.deletedAt !== null) return "Delegation target does not exist.";
  if (target.id === input.principal.assistantThreadId || target.kind === "assistant") {
    return "T3 Assistant cannot delegate to itself or another assistant thread.";
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
