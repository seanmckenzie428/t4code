import { describe, expect, it } from "vite-plus/test";
import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  OrchestrationV2ConversationMessage,
  OrchestrationV2ConversationMessageJson,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { latestDesktopReply } from "./desktopReply";

const encodeMessage = Schema.encodeSync(OrchestrationV2ConversationMessageJson);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationV2ConversationMessageJson);
const decodeLegacyMessage = Schema.decodeSync(OrchestrationV2ConversationMessage);
const threadId = ThreadId.make("thread");
const runId = RunId.make("run");
const root = NodeId.make("root");
const at = DateTime.makeUnsafe("2026-10-07T12:00:00.000Z");
function fixture(): Parameters<typeof latestDesktopReply>[0] {
  return {
    threadId,
    working: false,
    dismissedMessageId: null,
    attempts: [],
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        providerThreadId: null,
        userMessageId: MessageId.make("user"),
        rootNodeId: root,
        activeAttemptId: null,
        status: "completed",
        requestedAt: at,
        startedAt: at,
        completedAt: at,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    nodes: [
      {
        id: NodeId.make("answer-node"),
        threadId,
        runId,
        parentNodeId: root,
        rootNodeId: root,
        kind: "assistant_message",
        status: "completed",
        countsForRun: false,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: null,
        startedAt: at,
        completedAt: at,
      },
    ],
    messages: [
      {
        id: MessageId.make("answer"),
        threadId,
        runId,
        nodeId: NodeId.make("answer-node"),
        role: "assistant",
        assistantPhase: "final_answer",
        text: "Done.",
        attachments: [],
        streaming: false,
        createdAt: at,
        updatedAt: at,
        createdBy: "agent",
        creationSource: "provider",
      },
    ],
  };
}

describe("desktop final replies", () => {
  it("shows a confirmed root reply only after successful run completion", () => {
    const input = fixture();
    expect(latestDesktopReply(input)?.message.text).toBe("Done.");
    expect(latestDesktopReply({ ...input, working: true })).toBeNull();
    for (const status of ["running", "waiting", "failed", "interrupted", "cancelled"] as const) {
      expect(
        latestDesktopReply({ ...input, runs: input.runs.map((run) => ({ ...run, status })) }),
      ).toBeNull();
    }
  });
  it("rejects commentary, legacy unknown, streamed and empty messages", () => {
    const input = fixture();
    for (const patch of [
      { assistantPhase: "commentary" as const },
      { streaming: true },
      { text: " " },
    ]) {
      expect(
        latestDesktopReply({
          ...input,
          messages: input.messages.map((message) => ({ ...message, ...patch })),
        }),
      ).toBeNull();
    }
    const { assistantPhase: _phase, ...legacy } = input.messages[0]!;
    expect(latestDesktopReply({ ...input, messages: [legacy] })).toBeNull();
    expect(latestDesktopReply({ ...input, messages: [] })).toBeNull();
  });
  it("rejects child replies, stale attempts and unrelated threads", () => {
    const input = fixture();
    expect(
      latestDesktopReply({
        ...input,
        nodes: input.nodes.map((node) => ({ ...node, parentNodeId: NodeId.make("child") })),
      }),
    ).toBeNull();
    expect(
      latestDesktopReply({
        ...input,
        nodes: input.nodes.map((node) => ({ ...node, rootNodeId: NodeId.make("old-attempt") })),
      }),
    ).toBeNull();
    expect(
      latestDesktopReply({
        ...input,
        messages: input.messages.map((message) => ({
          ...message,
          senderThreadId: ThreadId.make("child"),
        })),
      }),
    ).toBeNull();
    expect(latestDesktopReply({ ...input, threadId: ThreadId.make("other") })).toBeNull();
  });
  it("does not revive handled or previous replies when a new run starts or fails", () => {
    const input = fixture();
    expect(latestDesktopReply({ ...input, dismissedMessageId: "answer" })).toBeNull();
    expect(
      latestDesktopReply({
        ...input,
        runs: [
          ...input.runs,
          { ...input.runs[0]!, id: RunId.make("next"), ordinal: 2, status: "failed" },
        ],
      }),
    ).toBeNull();
  });
  it("requires the completed active attempt and excludes prior provider turns", () => {
    const input = fixture();
    const attempt = {
      id: RunAttemptId.make("attempt"),
      runId,
      attemptOrdinal: 1,
      rootNodeId: root,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerThreadId: ProviderThreadId.make("provider-thread"),
      providerTurnId: ProviderTurnId.make("provider-turn"),
      reason: "initial" as const,
      status: "completed" as const,
      startedAt: at,
      completedAt: at,
    };
    const current = {
      ...input,
      attempts: [attempt],
      runs: input.runs.map((run) => ({ ...run, activeAttemptId: attempt.id })),
      nodes: input.nodes.map((node) => ({ ...node, providerTurnId: attempt.providerTurnId })),
    };
    expect(latestDesktopReply(current)?.message.id).toBe("answer");
    expect(latestDesktopReply({ ...current, attempts: [] })).toBeNull();
    expect(
      latestDesktopReply({ ...current, attempts: [{ ...attempt, status: "running" }] }),
    ).toBeNull();
    expect(latestDesktopReply({ ...current, nodes: input.nodes })).toBeNull();
    expect(
      latestDesktopReply({
        ...current,
        attempts: [{ ...attempt, rootNodeId: NodeId.make("replacement") }],
      }),
    ).toBeNull();
  });
  it("preserves explicit classification through JSON snapshots while old data stays unknown", () => {
    const message = fixture().messages[0]!;
    const encoded = encodeMessage(message);
    expect(decodeMessage(JSON.parse(JSON.stringify(encoded))).assistantPhase).toBe("final_answer");
    const { assistantPhase: _phase, ...legacy } = message;
    expect(decodeLegacyMessage(legacy).assistantPhase).toBeUndefined();
  });
});
