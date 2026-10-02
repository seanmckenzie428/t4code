import {
  EventId,
  NodeId,
  PlanId,
  TurnId,
  TurnItemId,
  ToolActivityIcon,
  ToolActivitySource,
  OrchestrationV2TurnItemJson,
  type OrchestrationThreadActivity,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2PlanStep,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as EventSink from "../EventSink.ts";
import { legacyRunIdentity } from "./PilotLegacyHistory.ts";

const PREFIX = "migration:pilot-v1:work-log";
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeToolIcon = Schema.decodeUnknownOption(ToolActivityIcon);
const decodeToolSource = Schema.decodeUnknownOption(ToolActivitySource);
const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
interface ActivityRow {
  readonly activity_id: string;
  readonly turn_id: string | null;
  readonly kind: string;
  readonly tone: OrchestrationThreadActivity["tone"];
  readonly summary: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly sequence: number | null;
}
interface PlanRow {
  readonly plan_id: string;
  readonly turn_id: string | null;
  readonly plan_markdown: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly implemented_at: string | null;
}
interface MessagePosition {
  readonly message_id: string;
  readonly created_at: string;
  readonly role: string;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function parse(value: string): unknown {
  return Option.getOrElse(decodePayload(value), () => value);
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function planSteps(
  payload: Record<string, unknown> | undefined,
): OrchestrationV2PlanStep[] | undefined {
  if (!Array.isArray(payload?.plan)) return undefined;
  return payload.plan.flatMap((value, index) => {
    const step = record(value);
    const label = text(step?.step) ?? text(step?.text);
    if (!label) return [];
    return [
      {
        id: String(index),
        text: label,
        status:
          step?.status === "completed"
            ? ("completed" as const)
            : step?.status === "in_progress" || step?.status === "running"
              ? ("running" as const)
              : ("pending" as const),
      },
    ];
  });
}

/** Preserve the readable V1 work history without reactivating old requests or tasks. */
export const importLegacyWorkLog = Effect.fn("PilotLegacyWorkLog.import")(function* (
  threadId: ThreadId,
  messages: ReadonlyArray<MessagePosition>,
) {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  const activities = yield* sql<ActivityRow>`
    SELECT activity_id, turn_id, kind, tone, summary, payload_json, created_at, sequence
    FROM projection_thread_activities WHERE thread_id = ${threadId}
    ORDER BY sequence, created_at, activity_id
  `;
  const plans = yield* sql<PlanRow>`
    SELECT plan_id, turn_id, plan_markdown, created_at, updated_at, implemented_at
    FROM projection_thread_proposed_plans WHERE thread_id = ${threadId}
    ORDER BY created_at, plan_id
  `;
  // Repeated tool/progress updates are one historical row, with their original
  // payloads retained in the inspector so partial updates cannot erase output.
  const groups = new Map<string, { rows: ActivityRow[]; payloads: unknown[]; agentId?: string }>();
  for (const activity of activities) {
    const payload = parse(activity.payload_json);
    const data = record(payload);
    const toolData = record(data?.data);
    const itemId =
      text(data?.itemId) ??
      text(data?.toolCallId) ??
      text(data?.toolUseId) ??
      text(toolData?.toolCallId) ??
      text(toolData?.id);
    const taskId = text(data?.taskId);
    const agentId = text(data?.agentId) ?? (data?.timelineBypass === true ? taskId : undefined);
    const key = agentId
      ? `agent:${activity.turn_id}:${agentId}`
      : activity.kind === "turn.plan.updated"
        ? `plan:${activity.turn_id ?? activity.activity_id}`
        : activity.kind.startsWith("tool.") && itemId
          ? `tool:${activity.turn_id}:${itemId}`
          : activity.kind.startsWith("task.") && taskId
            ? `task:${activity.turn_id}:${taskId}`
            : activity.activity_id;
    const group = groups.get(key) ?? { rows: [], payloads: [], ...(agentId ? { agentId } : {}) };
    group.rows.push(activity);
    group.payloads.push(payload);
    groups.set(key, group);
  }
  const items: OrchestrationV2TurnItem[] = [];
  const planEvents: OrchestrationV2DomainEvent[] = [];
  const base = (id: string, turnId: string | null, startedAt: string, updatedAt: string) => ({
    id: TurnItemId.make(`${PREFIX}:${id}`),
    threadId,
    ...(turnId === null ? { runId: null, nodeId: null } : legacyRunIdentity(turnId)),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed" as const,
    title: null,
    startedAt: DateTime.makeUnsafe(startedAt),
    completedAt: DateTime.makeUnsafe(updatedAt),
    updatedAt: DateTime.makeUnsafe(updatedAt),
  });
  for (const { rows, payloads, agentId } of groups.values()) {
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const payload = Object.assign({}, ...payloads.map(record));
    const itemBase = base(first.activity_id, last.turn_id, first.created_at, last.created_at);
    // Agent-owned details stay one expandable history row instead of flooding
    // the parent timeline with tools that V1 kept in its Agents surface.
    if (agentId) {
      items.push({
        ...itemBase,
        type: "dynamic_tool",
        title: "Agent activity",
        toolName: "Agent history",
        input: { agentId },
        output: rows.map((row, index) => ({
          kind: row.kind,
          summary: row.summary,
          createdAt: row.created_at,
          payload: payloads[index],
        })),
      });
      continue;
    }
    const steps = last.kind === "turn.plan.updated" ? planSteps(payload) : undefined;
    if (steps !== undefined) {
      const planId = PlanId.make(`${PREFIX}:plan:${first.activity_id}`);
      const explanation = text(payload?.explanation);
      items.push({
        ...itemBase,
        type: "todo_list",
        planId,
        steps,
        ...(explanation ? { explanation } : {}),
      });
      planEvents.push({
        id: EventId.make(`${PREFIX}:plan:${first.activity_id}`),
        type: "plan.updated",
        threadId,
        occurredAt: itemBase.updatedAt,
        payload: {
          id: planId,
          threadId,
          runId: itemBase.runId,
          nodeId: itemBase.nodeId ?? NodeId.make(`${PREFIX}:node:${first.activity_id}`),
          kind: "todo_list",
          status: steps.every((step) => step.status === "completed") ? "completed" : "active",
          steps,
          ...(explanation ? { explanation } : {}),
        },
      });
      continue;
    }
    const summary = last.summary.trim() || last.kind;
    if (last.kind.startsWith("tool.")) {
      const data = Object.assign({}, ...payloads.map((value) => record(record(value)?.data)));
      const toolIcon = Option.getOrUndefined(decodeToolIcon(payload.toolIcon));
      const toolSource = Option.getOrUndefined(decodeToolSource(payload.toolSource));
      const status = text(payload?.status) ?? text(data?.status);
      items.push({
        ...itemBase,
        type: "dynamic_tool",
        title: summary,
        ...(payload.toolSurface === "browser" || payload.toolSurface === "computer"
          ? { toolSurface: payload.toolSurface }
          : {}),
        ...(toolIcon ? { toolIcon } : {}),
        ...(toolSource ? { toolSource } : {}),
        status:
          last.tone === "error" || status === "failed"
            ? "failed"
            : last.kind === "tool.completed" || status === "completed"
              ? "completed"
              : "interrupted",
        toolName: text(data?.toolName) ?? text(payload?.toolName) ?? null,
        input: data?.input ?? payload?.input ?? payloads[0],
        output: payloads.length === 1 ? payloads[0] : payloads,
      });
      continue;
    }
    const activity: OrchestrationThreadActivity = {
      id: EventId.make(last.activity_id),
      kind: last.kind,
      tone: last.tone,
      summary,
      payload: payloads.at(-1),
      turnId: last.turn_id === null ? null : TurnId.make(last.turn_id),
      createdAt: last.created_at,
      ...(last.sequence === null ? {} : { sequence: last.sequence }),
    };
    items.push({
      ...itemBase,
      type: "notification",
      title: summary,
      activity,
      source: { kind: "background_task" },
      outcome: last.tone === "error" ? "failed" : "updated",
      summary,
      detail: encodePayload(payloads.length === 1 ? payloads[0] : payloads),
    });
  }
  for (const plan of plans) {
    const itemBase = base(
      `proposed-plan:${plan.plan_id}`,
      plan.turn_id,
      plan.created_at,
      plan.updated_at,
    );
    const planId = PlanId.make(plan.plan_id);
    items.push({
      ...itemBase,
      type: "proposed_plan",
      planId,
      markdown: plan.plan_markdown,
      streaming: false,
    });
    planEvents.push({
      id: EventId.make(`${PREFIX}:plan:${plan.plan_id}`),
      type: "plan.updated",
      threadId,
      occurredAt: itemBase.updatedAt,
      payload: {
        id: planId,
        threadId,
        runId: itemBase.runId,
        nodeId: itemBase.nodeId ?? NodeId.make(`${PREFIX}:node:${plan.plan_id}`),
        kind: "proposed_plan",
        status: plan.implemented_at === null ? "active" : "completed",
        markdown: plan.plan_markdown,
      },
    });
  }
  const positions = [
    ...messages.map((message) => ({
      id: TurnItemId.make(`migration:v1:turn-item:${message.message_id}`),
      at: message.created_at,
      priority: message.role === "user" ? 0 : 2,
    })),
    ...items.map((item) => ({
      id: item.id,
      at: DateTime.formatIso(item.startedAt ?? item.updatedAt),
      priority: 1,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.priority - b.priority || a.id.localeCompare(b.id));
  const ordinalById = new Map(positions.map((position, index) => [position.id, index + 1]));
  yield* sql.withTransaction(
    Effect.gen(function* () {
      // Moving one row at a time can collide with another preview's old ordinal.
      // These are derived import positions only; live V2 allocations stay intact.
      yield* sql`DELETE FROM orchestration_v2_turn_item_positions
      WHERE thread_id = ${threadId} AND
        (turn_item_id LIKE 'migration:v1:turn-item:%' OR turn_item_id LIKE ${`${PREFIX}:%`})`;
      for (const [id, ordinal] of ordinalById) {
        yield* sql`INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
        VALUES (${threadId}, ${id}, ${ordinal})`;
      }
    }),
  );
  const events = [
    ...planEvents,
    ...items.map((item): OrchestrationV2DomainEvent => ({
      id: EventId.make(`${PREFIX}:item:${item.id}`),
      type: "turn-item.updated",
      threadId,
      occurredAt: item.updatedAt,
      payload: { ...item, ordinal: ordinalById.get(item.id)! },
    })),
  ];
  // Shell previews already have message events. Correct their positions through
  // events as well, so rebuilding projections preserves the full chronology.
  const previews = yield* sql<{ readonly payload_json: string }>`
    SELECT payload_json FROM orchestration_v2_projection_turn_items
    WHERE thread_id = ${threadId} AND turn_item_id LIKE 'migration:v1:turn-item:%'
  `;
  for (const preview of previews) {
    const item = yield* decodeItem(preview.payload_json);
    const ordinal = ordinalById.get(item.id);
    if (ordinal === undefined || ordinal === item.ordinal) continue;
    events.push({
      id: EventId.make(`${PREFIX}:position:${item.id}`),
      type: "turn-item.updated",
      threadId,
      occurredAt: item.updatedAt,
      payload: { ...item, ordinal },
    });
  }
  const existing = new Set(
    (yield* sql<{ readonly event_id: string }>`
    SELECT event_id FROM orchestration_events WHERE application_event_version = 2
      AND stream_id = ${threadId} AND event_id LIKE ${`${PREFIX}:%`}
  `).map((row) => row.event_id),
  );
  const missing = events.filter((event) => !existing.has(event.id));
  for (let index = 0; index < missing.length; index += 100) {
    yield* sink.write({ events: missing.slice(index, index + 100) });
    yield* Effect.yieldNow;
  }
  return new Map(
    messages.map((message) => [
      message.message_id,
      ordinalById.get(TurnItemId.make(`migration:v1:turn-item:${message.message_id}`))!,
    ]),
  );
});
