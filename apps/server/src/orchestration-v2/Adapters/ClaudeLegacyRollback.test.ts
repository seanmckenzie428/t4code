import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  ClaudeSettings,
  NodeId,
  ProviderSessionId,
  ProviderTurnId,
  RunAttemptId,
  ThreadId,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import * as Claude from "./ClaudeAdapterV2.ts";
import type { ClaudeSessionHistoryInput } from "./ClaudeSessionHistory.ts";

const defaultSettings = Schema.decodeSync(ClaudeSettings)({});

it.effect(
  "rewinds imported Claude history by native user UUID, retaining a reusable assistant cursor",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const reads: ClaudeSessionHistoryInput[] = [];
        const forks: Claude.ClaudeAgentSdkSessionForkInput[] = [];
        const environment = { CLAUDE_CONFIG_DIR: "/managed/provider-home" };
        const adapter = Claude.makeClaudeAdapterV2({
          instanceId: Claude.CLAUDE_DEFAULT_INSTANCE_ID,
          settings: defaultSettings,
          environment,
          attachmentsDir: yield* fileSystem.makeTempDirectoryScoped(),
          fileSystem,
          path: yield* Path.Path,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          queryRunner: {
            allocateSessionId: Effect.succeed("native-session"),
            open: () =>
              Effect.succeed({
                messages: Stream.empty,
                offer: () => Effect.void,
                setModel: () => Effect.void,
                interrupt: Effect.void,
                close: Effect.void,
              }),
            forkSession: (input) =>
              Effect.sync(() => {
                forks.push(input);
                return { sessionId: "forked-session" };
              }),
            subagentLaunchToolUseId: () => Effect.succeed(null),
            assertComplete: Effect.void,
            readSessionHistory: (input) =>
              Effect.sync(() => {
                reads.push(input);
                return [
                  {
                    type: "user",
                    uuid: "user-1",
                    parent_tool_use_id: null,
                    message: { content: "first" },
                  },
                  {
                    type: "assistant",
                    uuid: "assistant-1",
                    parent_tool_use_id: null,
                    message: { content: "first response" },
                  },
                  {
                    type: "user",
                    uuid: "user-2",
                    parent_tool_use_id: null,
                    message: { content: "second" },
                  },
                ];
              }),
          },
        });
        const threadId = ThreadId.make("legacy-claude");
        const modelSelection = {
          instanceId: Claude.CLAUDE_DEFAULT_INSTANCE_ID,
          model: "claude-sonnet-4-6",
        };
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace",
        });
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("session"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = {
          ...(yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy })),
          nativeMetadata: { legacyClaudeTurnStartMessageIds: ["user-1", "user-2"] },
        };
        const now = yield* DateTime.now;
        const target: OrchestrationV2ProviderTurn = {
          id: ProviderTurnId.make("imported-provider-turn"),
          providerThreadId: providerThread.id,
          nodeId: NodeId.make("node"),
          runAttemptId: RunAttemptId.make("attempt"),
          nativeTurnRef: null,
          legacyClaudeUserMessageId: "user-1",
          ordinal: 99,
          status: "completed",
          startedAt: now,
          completedAt: now,
        };
        const result = yield* runtime.rollbackThread({
          providerThread,
          target: {
            type: "provider_turn",
            checkpointId: CheckpointId.make("checkpoint"),
            appRunOrdinal: 101,
            providerTurn: target,
          },
          providerThreadTurns: [
            target,
            { ...target, id: ProviderTurnId.make("later"), ordinal: 100 },
          ],
        });
        assert.equal(result.providerThread.nativeConversationHeadRef?.nativeId, "assistant-1");
        assert.equal(result.providerTurns[0]?.nativeTurnRef?.nativeId, "assistant-1");
        assert.deepEqual(reads, [{ sessionId: "native-session", dir: "/workspace", environment }]);
        const forked = yield* runtime.forkThread({
          sourceProviderThread: providerThread,
          sourceProviderTurns: [
            target,
            { ...target, id: ProviderTurnId.make("later"), ordinal: 100 },
          ],
          providerTurnId: target.id,
          targetThreadId: ThreadId.make("forked-legacy"),
        });
        assert.equal(forked.nativeThreadRef?.nativeId, "forked-session");
        assert.deepEqual(forks[0]?.environment, environment);
        assert.equal(forks[0]?.options.upToMessageId, "assistant-1");
        const foreign = yield* runtime
          .rollbackThread({
            providerThread,
            target: {
              type: "provider_turn",
              checkpointId: CheckpointId.make("foreign"),
              appRunOrdinal: 102,
              providerTurn: { ...target, legacyClaudeUserMessageId: "different-session" },
            },
            providerThreadTurns: [target],
          })
          .pipe(Effect.flip);
        assert.equal(foreign._tag, "ProviderAdapterRollbackThreadError");
      }),
    ).pipe(Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer))),
);
