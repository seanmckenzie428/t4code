import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CursorSettings,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ServerConfig from "../../config.ts";
import * as IdAllocator from "../IdAllocator.ts";
import {
  ProviderAdapterV2RuntimePolicy,
  ProviderAdapterProtocolError,
  type ProviderAdapterV2TurnInput,
} from "../ProviderAdapter.ts";
import { makeLegacyCursorAcpAdapter, routeLegacyCursorAcp } from "./CursorLegacyAcp.ts";

const settings = Schema.decodeSync(CursorSettings)({
  binaryPath: "/custom/bin/cursor-agent",
  apiEndpoint: "https://cursor.example.test",
});
const decodeFrame = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.optional(Schema.String),
      params: Schema.optional(Schema.Unknown),
    }),
  ),
);
const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "pilot-cursor-legacy-",
}).pipe(Layer.provide(NodeServices.layer));
const testLayer = Layer.mergeAll(NodeServices.layer, IdAllocator.layer, serverConfigLayer);

function makeTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly instanceId: ProviderInstanceId;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  readonly now: DateTime.Utc;
  readonly ordinal?: number;
  readonly modelSelection?: ModelSelection;
  /** agent+provider marks a post-settle continuation attach (drains wakeBuffer). */
  readonly messageCreatedBy?: "user" | "agent";
  readonly messageCreationSource?: "web" | "mobile" | "mcp" | "provider" | "server";
  readonly messageText?: string;
}): ProviderAdapterV2TurnInput {
  const ordinal = input.ordinal ?? 1;
  const suffix = `${input.threadId}:${ordinal}`;
  const modelSelection =
    input.modelSelection ?? ({ instanceId: input.instanceId, model: "default" } as const);
  return {
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make(`project:${input.threadId}`),
      title: "ACP adapter test",
      providerInstanceId: input.instanceId,
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: input.providerThread.id,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId: input.threadId,
    runId: RunId.make(`run:${suffix}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt:${suffix}`),
    rootNodeId: NodeId.make(`node:${suffix}`),
    providerThread: input.providerThread,
    message: {
      createdBy: input.messageCreatedBy ?? "user",
      creationSource: input.messageCreationSource ?? "web",
      messageId: MessageId.make(`message:${suffix}`),
      text: input.messageText ?? "test prompt",
      attachments: [],
    },
    modelSelection,
    runtimePolicy: input.runtimePolicy,
  };
}

it.live(
  "resumes legacy Cursor through ACP, preserves metadata across restart, and keeps unmarked sessions on SDK",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* fileSystem.makeTempDirectoryScoped();
      const requestLogPath = path.join(temp, "requests.jsonl");
      const mockPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      let spawnCount = 0;
      const childProcessSpawner = ChildProcessSpawner.make((command) => {
        assert.equal(command._tag, "StandardCommand");
        if (command._tag === "StandardCommand") {
          assert.equal(command.command, "/custom/bin/cursor-agent");
          assert.deepEqual(command.args, ["-e", "https://cursor.example.test", "--force", "acp"]);
          assert.equal(command.options.env?.CURSOR_CONFIG_DIR, "/custom/cursor-home");
          spawnCount += 1;
          return realSpawner.spawn(
            ChildProcess.make(process.execPath, [mockPath], {
              ...command.options,
              env: {
                ...command.options.env,
                T3_ACP_SESSION_LIFECYCLE: "1",
                T3_ACP_AUTH_METHOD_ID: "cursor_login",
                T3_ACP_REQUEST_LOG_PATH: requestLogPath,
              },
            }),
          );
        }
        return realSpawner.spawn(command);
      });
      const instanceId = ProviderInstanceId.make("cursor-personal");
      const legacy = makeLegacyCursorAcpAdapter({
        instanceId,
        settings,
        environment: { ...process.env, CURSOR_CONFIG_DIR: "/custom/cursor-home" },
        childProcessSpawner,
        crypto: yield* Crypto.Crypto,
        fileSystem,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig,
        selfInvocation: yield* resolveSelfInvocation(),
      });
      let sdkCalls = 0;
      const sdk = {
        ...legacy,
        openSession: () =>
          Effect.suspend(() => {
            sdkCalls += 1;
            return Effect.fail(
              new ProviderAdapterProtocolError({
                driver: legacy.driver,
                detail: "SDK route selected",
              }),
            );
          }),
      };
      const adapter = routeLegacyCursorAcp(sdk, legacy);
      const threadId = ThreadId.make("legacy-cursor-thread");
      const modelSelection = { instanceId, model: "default" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: temp,
      });
      const open = {
        threadId,
        modelSelection,
        runtimePolicy,
        providerSessionId: ProviderSessionId.make("legacy-runtime"),
        initialNativeThreadId: "persisted-acp-session",
        initialNativeMetadata: { legacyCursorAcp: true as const },
      };
      const runtimeScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const runtime = yield* adapter
        .openSession(open)
        .pipe(Effect.provideService(Scope.Scope, runtimeScope));
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      assert.equal(providerThread.nativeThreadRef?.nativeId, "persisted-acp-session");
      assert.isTrue(providerThread.nativeMetadata?.legacyCursorAcp);
      assert.isFalse(runtime.providerSession.capabilities.threads.canForkThread);
      assert.isFalse(runtime.providerSession.capabilities.threads.canRollbackThread);
      yield* runtime.resumeThread({ providerThread, modelSelection, runtimePolicy });
      const now = yield* DateTime.now;
      const turn = makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now });
      yield* runtime.startTurn(turn);
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      assert.isTrue(
        events.some(
          (event) => event.type === "message.updated" && event.message.role === "assistant",
        ),
      );
      const updated = events.filter((event) => event.type === "provider_thread.updated");
      assert.isAbove(updated.length, 0);
      assert.isTrue(updated.every((event) => event.providerThread.nativeMetadata?.legacyCursorAcp));
      assert(runtime.compactThread !== undefined);
      yield* runtime.compactThread(
        makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now, ordinal: 2 }),
      );
      const compactEvents = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      assert.isTrue(
        compactEvents.some(
          (event) =>
            event.type === "turn_item.updated" &&
            event.turnItem.type === "compaction" &&
            event.turnItem.status === "completed",
        ),
      );
      const snapshot = yield* runtime.readThreadSnapshot({ providerThread });
      assert.isTrue(snapshot.providerThread.nativeMetadata?.legacyCursorAcp);
      yield* Scope.close(runtimeScope, Exit.void);
      const reopenedScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const reopened = yield* adapter
        .openSession({
          ...open,
          providerSessionId: ProviderSessionId.make("after-restart"),
          initialNativeMetadata: snapshot.providerThread.nativeMetadata,
        })
        .pipe(Effect.provideService(Scope.Scope, reopenedScope));
      const resumed = yield* reopened.resumeThread({
        providerThread: snapshot.providerThread,
        modelSelection,
        runtimePolicy,
      });
      assert.isTrue(resumed.nativeMetadata?.legacyCursorAcp);
      assert.equal(spawnCount, 2);
      yield* Scope.close(reopenedScope, Exit.void);
      const wire = (yield* fileSystem.readFileString(requestLogPath))
        .trim()
        .split("\n")
        .map((line) => decodeFrame(line));
      assert.notInclude(
        wire.map((frame) => frame.method),
        "session/new",
      );
      assert.isTrue(
        wire.some((frame) => frame.method === "session/resume" || frame.method === "session/load"),
      );
      assert.isTrue(
        wire.some(
          (frame) =>
            frame.method === "session/prompt" && JSON.stringify(frame.params).includes("/compress"),
        ),
      );
      const { initialNativeMetadata: _metadata, ...unmarked } = open;
      yield* adapter.openSession(unmarked).pipe(Effect.flip);
      yield* adapter
        .openSession({
          threadId,
          modelSelection,
          runtimePolicy,
          providerSessionId: ProviderSessionId.make("new-sdk"),
        })
        .pipe(Effect.flip);
      assert.equal(sdkCalls, 2);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
);
