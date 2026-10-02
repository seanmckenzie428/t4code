import {
  CheckpointRef,
  EventId,
  MessageId,
  NodeId,
  OrchestrationV2AppThreadJson,
  OrchestrationV2CheckpointFileSummary,
  OrchestrationV2ProviderThreadJson,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as EventSink from "../EventSink.ts";
import * as IdAllocator from "../IdAllocator.ts";

import { remapLegacyClaudeForkTurnBoundaries } from "./ClaudeForkTurnBoundaries.ts";

const PREFIX = "migration:pilot-v1";

/** Keep the old turn identity: Review's persisted Viewed scopes use it. */
export function legacyRunIdentity(turnId: string) {
  return {
    runId: RunId.make(turnId),
    nodeId: NodeId.make(`${PREFIX}:node:${turnId}`),
  };
}

interface LegacyTurnRow {
  readonly turn_id: string;
  readonly pending_message_id: string | null;
  readonly state: string;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly checkpoint_turn_count: number | null;
  readonly checkpoint_ref: string | null;
  readonly checkpoint_status: string | null;
  readonly checkpoint_files_json: string;
}

const decodeThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeProviderThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderThreadJson),
);
const decodeFiles = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(OrchestrationV2CheckpointFileSummary)),
);

function runStatus(state: string): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (state) {
    case "completed":
      return "completed";
    case "error":
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "interrupted";
  }
}

/** Hydrate historical review data before accepting another run in a migrated thread. */
export const importLegacyHistory = Effect.fn("PilotLegacyHistory.import")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const rows = yield* sql<LegacyTurnRow>`
    SELECT turn_id, pending_message_id, state, requested_at, started_at, completed_at,
      checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
    FROM projection_turns
    WHERE thread_id = ${threadId} AND turn_id IS NOT NULL
    ORDER BY requested_at, row_id
  `;
  if (rows.length === 0) return;
  const threadRows = yield* sql<{ readonly payload_json: string; readonly workspace_root: string }>`
    SELECT current.payload_json, project.workspace_root
    FROM orchestration_v2_projection_threads AS current
    JOIN projection_threads AS legacy ON legacy.thread_id = current.thread_id
    JOIN projection_projects AS project ON project.project_id = legacy.project_id
    WHERE current.thread_id = ${threadId}
  `;
  const threadRow = threadRows[0];
  if (threadRow === undefined) return;
  const thread = yield* decodeThread(threadRow.payload_json);
  const providerRows = yield* sql<{ readonly payload_json: string }>`
    SELECT payload_json FROM orchestration_v2_projection_provider_threads
    WHERE provider_thread_id = ${thread.activeProviderThreadId}
  `;
  const providerThread =
    providerRows[0] === undefined
      ? undefined
      : yield* decodeProviderThread(providerRows[0].payload_json);
  const sessions = yield* sql<{
    readonly turn_id: string;
    readonly driver: string | null;
    readonly instance_id: string | null;
  }>`
    SELECT json_extract(payload_json, '$.session.activeTurnId') AS turn_id,
      json_extract(payload_json, '$.session.providerName') AS driver,
      json_extract(payload_json, '$.session.providerInstanceId') AS instance_id
    FROM orchestration_events
    WHERE application_event_version = 1 AND stream_id = ${threadId}
      AND event_type = 'thread.session-set'
      AND json_extract(payload_json, '$.session.activeTurnId') IS NOT NULL
    ORDER BY sequence
  `;
  const sessionByTurn = new Map(sessions.map((session) => [session.turn_id, session]));
  const startedRows = rows.filter((row) => {
    if (row.started_at === null) return false;
    const session = sessionByTurn.get(row.turn_id);
    return (
      session === undefined ||
      ((session.driver === null || session.driver === providerThread?.driver) &&
        (session.instance_id === null ||
          session.instance_id === providerThread?.providerInstanceId))
    );
  });
  const nativeOrdinalByTurn = new Map(startedRows.map((row, index) => [row.turn_id, index + 1]));
  const lastClaudeUserMessageId =
    providerThread?.nativeMetadata?.legacyClaudeTurnStartMessageIds?.at(-1);
  const reverted =
    providerThread?.driver === "claudeAgent"
      ? yield* sql`SELECT 1 FROM orchestration_events WHERE application_event_version = 1
        AND stream_id = ${threadId} AND event_type = 'thread.reverted' LIMIT 1`
      : [];
  const remappedClaudeUserIds =
    providerThread?.driver === "claudeAgent"
      ? remapLegacyClaudeForkTurnBoundaries({
          hasReverted: reverted.length > 0,
          providerInstanceId: providerThread.providerInstanceId,
          nativeBoundaries: providerThread.nativeMetadata?.legacyClaudeTurnStartMessageIds,
          turns: rows
            .filter((row) => row.started_at !== null)
            .map((row) => ({
              turnId: row.turn_id,
              pendingMessageId: row.pending_message_id,
              driver: sessionByTurn.get(row.turn_id)?.driver,
              providerInstanceId: sessionByTurn.get(row.turn_id)?.instance_id,
            })),
        })
      : undefined;
  const scopeId = yield* ids.allocate.checkpointScope({ threadId, name: "root" });
  const existingRows = yield* sql<{ readonly event_id: string }>`
    SELECT event_id FROM orchestration_events
    WHERE application_event_version = 2 AND stream_id = ${threadId}
      AND event_id LIKE ${`${PREFIX}:%`}
  `;
  const existing = new Set(existingRows.map((row) => row.event_id));
  const events: Array<OrchestrationV2DomainEvent> = [];
  const first = rows[0]!;
  const firstIdentity = legacyRunIdentity(first.turn_id);
  const scopeCreatedAt = DateTime.makeUnsafe(first.requested_at);
  events.push({
    id: EventId.make(`${PREFIX}:scope:${threadId}`),
    type: "checkpoint-scope.created",
    threadId,
    occurredAt: scopeCreatedAt,
    payload: {
      id: scopeId,
      threadId,
      ...firstIdentity,
      parentScopeId: null,
      providerThreadId: thread.activeProviderThreadId,
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: thread.worktreePath ?? threadRow.workspace_root,
      createdAt: scopeCreatedAt,
    },
  });
  let parentCheckpointId = yield* ids.allocate.checkpoint({
    checkpointScopeId: scopeId,
    name: "0",
  });
  // V1's baseline is a real Git ref. Retain it instead of inventing a V2 ref
  // that cannot resolve until another turn has touched this workspace.
  events.push({
    id: EventId.make(`${PREFIX}:baseline:${threadId}`),
    type: "checkpoint.captured",
    threadId,
    occurredAt: scopeCreatedAt,
    payload: {
      id: parentCheckpointId,
      threadId,
      scopeId,
      runId: null,
      nodeId: firstIdentity.nodeId,
      parentCheckpointId: null,
      ordinalWithinScope: 0,
      appRunOrdinal: null,
      ref: checkpointRefForThreadTurn(threadId, 0),
      status: "ready",
      files: [],
      capturedAt: scopeCreatedAt,
    },
  });
  for (const [index, row] of rows.entries()) {
    const identity = legacyRunIdentity(row.turn_id);
    const requestedAt = DateTime.makeUnsafe(row.requested_at);
    const completedAt = DateTime.makeUnsafe(row.completed_at ?? row.started_at ?? row.requested_at);
    const status = runStatus(row.state);
    const checkpointCount = row.checkpoint_turn_count;
    // V1 turn ids are native Codex ids, but Claude used the submitted user UUID.
    // Its last assistant cursor is safe only for the final known native turn.
    const providerOrdinal = nativeOrdinalByTurn.get(row.turn_id) ?? 0;
    const hasProviderTurn = providerThread !== undefined && providerOrdinal > 0;
    const attemptId = hasProviderTurn
      ? RunAttemptId.make(`${PREFIX}:attempt:${row.turn_id}`)
      : null;
    const providerTurnId = hasProviderTurn
      ? ProviderTurnId.make(`${PREFIX}:provider-turn:${row.turn_id}`)
      : null;
    const checkpointId =
      checkpointCount !== null && checkpointCount > 0 && row.checkpoint_ref !== null
        ? yield* ids.allocate.checkpoint({
            checkpointScopeId: scopeId,
            name: String(checkpointCount),
          })
        : null;
    const run: OrchestrationV2Run = {
      id: identity.runId,
      threadId,
      ordinal: index + 1,
      providerInstanceId: thread.providerInstanceId,
      modelSelection: thread.modelSelection,
      providerThreadId: hasProviderTurn ? providerThread.id : null,
      userMessageId: MessageId.make(row.pending_message_id ?? `${PREFIX}:prompt:${row.turn_id}`),
      rootNodeId: identity.nodeId,
      activeAttemptId: attemptId,
      status,
      requestedAt,
      startedAt: row.started_at === null ? null : DateTime.makeUnsafe(row.started_at),
      completedAt,
      checkpointId,
      contextHandoffId: null,
    };
    events.push(
      {
        id: EventId.make(`${PREFIX}:run:${row.turn_id}`),
        type: "run.created",
        threadId,
        runId: identity.runId,
        occurredAt: completedAt,
        payload: run,
      },
      {
        id: EventId.make(`${PREFIX}:node:${row.turn_id}`),
        type: "node.updated",
        threadId,
        runId: identity.runId,
        occurredAt: completedAt,
        payload: {
          id: identity.nodeId,
          threadId,
          runId: identity.runId,
          parentNodeId: null,
          rootNodeId: identity.nodeId,
          kind: "root_turn",
          status,
          countsForRun: true,
          providerThreadId: run.providerThreadId,
          providerTurnId,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: scopeId,
          startedAt: run.startedAt,
          completedAt,
        },
      },
    );
    if (providerThread !== undefined && attemptId !== null && providerTurnId !== null) {
      const nativeThreadId = providerThread.nativeThreadRef?.nativeId;
      const claudeUserMessageId = remappedClaudeUserIds?.get(row.turn_id) ?? row.turn_id;
      const nativeTurnRef =
        providerThread.driver === "codex"
          ? { driver: providerThread.driver, nativeId: row.turn_id, strength: "strong" as const }
          : claudeUserMessageId === lastClaudeUserMessageId
            ? providerThread.nativeConversationHeadRef
            : null;
      events.push(
        {
          id: EventId.make(`${PREFIX}:attempt:${row.turn_id}`),
          type: "run-attempt.created",
          threadId,
          runId: identity.runId,
          occurredAt: completedAt,
          payload: {
            id: attemptId,
            ...(nativeThreadId ? { nativeThreadId } : {}),
            runId: identity.runId,
            attemptOrdinal: 1,
            rootNodeId: identity.nodeId,
            providerInstanceId: providerThread.providerInstanceId,
            providerThreadId: providerThread.id,
            providerTurnId,
            reason: "initial",
            status,
            startedAt: run.startedAt,
            completedAt,
          },
        },
        {
          id: EventId.make(`${PREFIX}:provider-turn:${row.turn_id}`),
          type: "provider-turn.updated",
          threadId,
          runId: identity.runId,
          occurredAt: completedAt,
          payload: {
            id: providerTurnId,
            providerThreadId: providerThread.id,
            nodeId: identity.nodeId,
            runAttemptId: attemptId,
            nativeTurnRef,
            ...(providerThread.driver === "claudeAgent"
              ? { legacyClaudeUserMessageId: claudeUserMessageId }
              : {}),
            ordinal: providerOrdinal,
            status,
            startedAt: run.startedAt,
            completedAt,
          },
        },
      );
    }
    if (checkpointId === null || checkpointCount === null || row.checkpoint_ref === null) continue;
    const checkpoint: OrchestrationV2Checkpoint = {
      id: checkpointId,
      threadId,
      scopeId,
      ...identity,
      parentCheckpointId,
      ordinalWithinScope: checkpointCount,
      appRunOrdinal: checkpointCount,
      ref: CheckpointRef.make(row.checkpoint_ref),
      status:
        row.checkpoint_status === "ready"
          ? "ready"
          : row.checkpoint_status === "missing"
            ? "missing"
            : "error",
      files: yield* decodeFiles(row.checkpoint_files_json),
      capturedAt: completedAt,
    };
    events.push({
      id: EventId.make(`${PREFIX}:checkpoint:${row.turn_id}`),
      type: "checkpoint.captured",
      threadId,
      runId: identity.runId,
      occurredAt: completedAt,
      payload: checkpoint,
    });
    parentCheckpointId = checkpointId;
  }
  const missing = events.filter((event) => !existing.has(event.id));
  for (let index = 0; index < missing.length; index += 100) {
    yield* sink.write({ events: missing.slice(index, index + 100) });
    yield* Effect.yieldNow;
  }
}, Effect.provide(IdAllocator.layer));
