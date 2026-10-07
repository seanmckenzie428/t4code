import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2ExecutionNode,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** A completed run is insufficient: provider phase and root provenance must agree. */
export function latestDesktopReply(input: {
  threadId: ThreadId;
  messages: readonly OrchestrationV2ConversationMessage[];
  runs: readonly OrchestrationV2Run[];
  nodes: readonly OrchestrationV2ExecutionNode[];
  attempts: readonly OrchestrationV2RunAttempt[];
  working: boolean;
  dismissedMessageId: string | null;
}) {
  if (input.working) return null;
  const run = input.runs
    .filter((run) => run.threadId === input.threadId)
    .reduce<OrchestrationV2Run | null>(
      (latest, current) => (!latest || current.ordinal > latest.ordinal ? current : latest),
      null,
    );
  if (!run || run.status !== "completed" || !run.completedAt || !run.rootNodeId) return null;
  const completedAt = DateTime.formatIso(run.completedAt);
  const attempt = run.activeAttemptId
    ? input.attempts.find(
        (attempt) => attempt.id === run.activeAttemptId && attempt.runId === run.id,
      )
    : null;
  if (run.activeAttemptId && (!attempt || attempt.status !== "completed")) return null;
  const rootNodeId = attempt?.rootNodeId ?? run.rootNodeId;
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const message = input.messages.findLast((message) => {
    if (
      message.threadId !== input.threadId ||
      message.runId !== run.id ||
      message.role !== "assistant" ||
      message.assistantPhase !== "final_answer" ||
      message.streaming ||
      !message.text.trim() ||
      message.notification ||
      message.senderThreadId ||
      message.delegation ||
      message.delegatedCompletion ||
      !message.nodeId
    )
      return false;
    const node = nodes.get(message.nodeId);
    return (
      node?.threadId === input.threadId &&
      node.runId === run.id &&
      node.kind === "assistant_message" &&
      node.status === "completed" &&
      node.parentNodeId === rootNodeId &&
      node.rootNodeId === rootNodeId &&
      (!attempt?.providerTurnId || node.providerTurnId === attempt.providerTurnId)
    );
  });
  return message && message.id !== input.dismissedMessageId ? { message, completedAt } : null;
}
