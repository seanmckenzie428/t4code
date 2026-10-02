import { describe, expect, it } from "vite-plus/test";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  RunId,
  type OrchestrationV2Checkpoint,
} from "@t3tools/contracts";
import { v2Projection, v2Now, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import {
  deriveThreadCheckpointSummaries,
  previousCheckpointTurnCount,
} from "./threadCheckpoints.ts";

describe("previousCheckpointTurnCount", () => {
  it("uses existing checkpoint counts across legacy and failed-run gaps", () => {
    const checkpoints = [1, 2, 5, 7].map((checkpointTurnCount) => ({ checkpointTurnCount }));
    expect(previousCheckpointTurnCount(checkpoints, 1)).toBe(0);
    expect(previousCheckpointTurnCount(checkpoints, 2)).toBe(1);
    expect(previousCheckpointTurnCount(checkpoints, 5)).toBe(2);
    expect(previousCheckpointTurnCount(checkpoints, 7)).toBe(5);
    expect(previousCheckpointTurnCount(checkpoints.toReversed(), 5)).toBe(2);
  });
});

it("preserves legacy counts while including synthetic baselines in each scope", () => {
  const checkpoint = (
    count: number,
    scope = "main",
    runId: RunId | null = RunId.make(`legacy-turn-${count}`),
  ): OrchestrationV2Checkpoint => ({
    id: CheckpointId.make(`${scope}-${count}`),
    threadId: v2ThreadId,
    scopeId: CheckpointScopeId.make(scope),
    runId,
    nodeId: NodeId.make("node"),
    parentCheckpointId: null,
    ordinalWithinScope: count,
    appRunOrdinal: runId === null ? null : count,
    ref: CheckpointRef.make(`refs/t3/checkpoints/${scope}-${count}`),
    status: "ready",
    files: [],
    capturedAt: v2Now,
  });
  const summaries = deriveThreadCheckpointSummaries({
    ...v2Projection,
    checkpoints: [
      checkpoint(1),
      checkpoint(2),
      checkpoint(4, "main", null),
      checkpoint(5),
      checkpoint(3, "child"),
    ],
  });
  expect(
    summaries.map(({ runId, checkpointTurnCount, previousCheckpointTurnCount }) => ({
      runId,
      checkpointTurnCount,
      previousCheckpointTurnCount,
    })),
  ).toEqual([
    { runId: "legacy-turn-1", checkpointTurnCount: 1, previousCheckpointTurnCount: 0 },
    { runId: "legacy-turn-2", checkpointTurnCount: 2, previousCheckpointTurnCount: 1 },
    { runId: "legacy-turn-5", checkpointTurnCount: 5, previousCheckpointTurnCount: 4 },
    { runId: "legacy-turn-3", checkpointTurnCount: 3, previousCheckpointTurnCount: 0 },
  ]);
});
