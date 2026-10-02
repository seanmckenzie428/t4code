import type {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface ThreadCheckpointSummary {
  readonly checkpointId?: CheckpointId;
  readonly scopeId?: CheckpointScopeId;
  readonly runId: RunId;
  readonly checkpointTurnCount: number;
  readonly previousCheckpointTurnCount?: number;
  readonly checkpointRef: CheckpointRef;
  readonly status: "ready" | "missing" | "error" | "stale";
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly assistantMessageId: MessageId | null;
  readonly completedAt: string;
}

/** Derives the checkpoint/diff rows needed by review UIs from native V2 entities. */
export function deriveThreadCheckpointSummaries(
  projection: OrchestrationV2ThreadProjection,
): ReadonlyArray<ThreadCheckpointSummary> {
  const countsByScope = new Map<CheckpointScopeId, number[]>();
  for (const checkpoint of projection.checkpoints) {
    // Baselines created before a resumed run have no app run, but their
    // scope ordinal is the boundary used by the checkpoint diff query.
    const count =
      checkpoint.appRunOrdinal ??
      (checkpoint.runId === null ? checkpoint.ordinalWithinScope : null);
    if (count === null) continue;
    const counts = countsByScope.get(checkpoint.scopeId) ?? [];
    counts.push(count);
    countsByScope.set(checkpoint.scopeId, counts);
  }
  const predecessorsByScope = new Map<CheckpointScopeId, Map<number, number>>();
  for (const [scopeId, counts] of countsByScope) {
    let previous = 0;
    const predecessors = new Map<number, number>();
    for (const count of [...new Set(counts)].sort((left, right) => left - right)) {
      predecessors.set(count, previous);
      previous = count;
    }
    predecessorsByScope.set(scopeId, predecessors);
  }
  return projection.checkpoints.flatMap((checkpoint) => {
    if (checkpoint.appRunOrdinal === null || checkpoint.runId === null) return [];
    const assistantMessageId =
      projection.messages.findLast(
        (message) => message.runId === checkpoint.runId && message.role === "assistant",
      )?.id ?? null;
    return [
      {
        checkpointId: checkpoint.id,
        scopeId: checkpoint.scopeId,
        runId: checkpoint.runId,
        checkpointTurnCount: checkpoint.appRunOrdinal,
        previousCheckpointTurnCount:
          predecessorsByScope.get(checkpoint.scopeId)?.get(checkpoint.appRunOrdinal) ?? 0,
        checkpointRef: checkpoint.ref,
        status: checkpoint.status,
        files: checkpoint.files,
        assistantMessageId,
        completedAt: DateTime.formatIso(checkpoint.capturedAt),
      },
    ];
  });
}

/** Imported histories can have failed runs without a checkpoint. */
export function previousCheckpointTurnCount(
  checkpoints: ReadonlyArray<Pick<ThreadCheckpointSummary, "checkpointTurnCount">>,
  turnCount: number,
): number {
  let previous = 0;
  for (const checkpoint of checkpoints) {
    if (checkpoint.checkpointTurnCount < turnCount) {
      previous = Math.max(previous, checkpoint.checkpointTurnCount);
    }
  }
  return previous;
}
