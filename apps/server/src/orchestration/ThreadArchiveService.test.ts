import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type TerminalMetadataStreamEvent,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { GitManager } from "../git/GitManager.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { ProviderValidationError } from "../provider/Errors.ts";
import {
  ProviderService,
  type ProviderThreadArchiveTarget,
} from "../provider/Services/ProviderService.ts";
import { makeThreadArchiveLock } from "../provider/threadArchiveLock.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as ThreadArchive from "./ThreadArchiveService.ts";
import * as ThreadBackgroundLiveness from "./ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "./ThreadPlanProgress.ts";
import * as ThreadSettlement from "./ThreadSettlementReactor.ts";

const START = "2026-09-01T12:00:00.000Z";
const SEVEN_DAYS = "2026-09-08T12:00:00.000Z";
const THREAD_ID = ThreadId.make("archive-thread");
const PROJECT_ID = ProjectId.make("archive-project");

const makeTestLayer = () =>
  Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(Layer.mock(RepositoryIdentityResolver)({ resolve: () => Effect.succeed(null) })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t4-thread-archive-test-" })),
    Layer.provide(NodeServices.layer),
  );

const makeHarness = Effect.fn("TestThreadArchive.makeHarness")(function* (enabled = true) {
  yield* TestClock.setTime(Date.parse(START));
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const liveness = yield* ThreadBackgroundLiveness.ThreadBackgroundLivenessService;
  const sql = yield* SqlClient.SqlClient;
  const parked = yield* Deferred.make<void>();
  const nativeRequests = yield* Queue.unbounded<{
    readonly target: ProviderThreadArchiveTarget;
    readonly archived: boolean;
    readonly release: Deferred.Deferred<void>;
  }>();
  const cancelRequests = yield* Queue.unbounded<Deferred.Deferred<void>>();
  const nativeReadRequests = yield* Queue.unbounded<Deferred.Deferred<void>>();
  const withLock = makeThreadArchiveLock();
  let settings = { ...DEFAULT_SERVER_SETTINGS, sidebarAutoArchiveSettled: enabled };
  let target: ProviderThreadArchiveTarget = {
    threadId: THREAD_ID,
    providerInstanceId: ProviderInstanceId.make("codex"),
    provider: ProviderDriverKind.make("codex"),
    continuationKey: "native-1",
    resumeCursor: { threadId: "native-1" },
  };
  const nativeStates = new Map<string, boolean>([[target.continuationKey, false]]);
  const nativeWrites: Array<{ readonly continuationKey: string; readonly archived: boolean }> = [];
  const effects: Array<string> = [];
  let failures = { archive: 0, restore: 0 };
  let gateNext = false;
  let gateNextCancel = false;
  let gateNextNativeRead = false;
  let supportsArchive = true;
  let injectLivenessAtCommit = false;
  let terminal: TerminalSummary | null = null;
  let metadataListener: ((event: TerminalMetadataStreamEvent) => Effect.Effect<void>) | undefined;

  const dependencies = Layer.mergeAll(
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.sync(() => settings),
      subscribeChanges: Effect.succeed(Stream.empty),
    }),
    Layer.mock(ProviderService)({
      withThreadArchiveLock: withLock,
      registerThreadResumePreparation: () => Effect.void,
      getThreadArchiveTarget: () => Effect.sync(() => (supportsArchive ? target : undefined)),
      listSessions: () => Effect.succeed([]),
      stopSession: () =>
        Effect.sync(() => {
          effects.push("stop-session");
        }),
      readNativeArchiveStates: (targets) =>
        Effect.gen(function* () {
          const observations = targets.map((captured) => ({
            target: captured,
            state: nativeStates.get(captured.continuationKey)
              ? ("archived" as const)
              : ("active" as const),
          }));
          if (gateNextNativeRead) {
            gateNextNativeRead = false;
            const release = yield* Deferred.make<void>();
            yield* Queue.offer(nativeReadRequests, release);
            yield* Deferred.await(release);
          }
          return observations;
        }),
      setNativeThreadArchived: (captured, archived) =>
        Effect.gen(function* () {
          effects.push(archived ? "native-archive" : "native-restore");
          if (gateNext) {
            gateNext = false;
            const release = yield* Deferred.make<void>();
            yield* Queue.offer(nativeRequests, { target: captured, archived, release });
            yield* Deferred.await(release);
          }
          if (captured.continuationKey !== target.continuationKey) return false;
          const direction = archived ? "archive" : "restore";
          if (failures[direction] > 0) {
            failures[direction] -= 1;
            return yield* new ProviderValidationError({
              operation: direction,
              issue: "Native provider offline",
            });
          }
          nativeStates.set(captured.continuationKey, archived);
          nativeWrites.push({ continuationKey: captured.continuationKey, archived });
          return true;
        }),
    }),
    Layer.mock(TerminalManager)({
      close: () =>
        Effect.gen(function* () {
          effects.push("close-terminals");
          if (terminal !== null && metadataListener !== undefined) {
            yield* metadataListener({
              type: "remove",
              threadId: terminal.threadId,
              terminalId: terminal.terminalId,
            });
          }
          terminal = null;
        }),
      closeIdle: () =>
        Effect.gen(function* () {
          effects.push("close-idle-terminals");
          if (injectLivenessAtCommit && nativeStates.get(target.continuationKey)) {
            injectLivenessAtCommit = false;
            liveness.recordTaskLiveness({
              threadId: THREAD_ID,
              taskId: "commit-race",
              taskType: "subagent",
              status: undefined,
              kind: "started",
            });
          }
          if (
            terminal !== null &&
            !terminal.hasRunningSubprocess &&
            metadataListener !== undefined
          ) {
            yield* metadataListener({
              type: "remove",
              threadId: terminal.threadId,
              terminalId: terminal.terminalId,
            });
            terminal = null;
          }
        }),
      subscribeMetadata: (listener) =>
        Effect.gen(function* () {
          metadataListener = listener;
          yield* listener({ type: "snapshot", terminals: terminal === null ? [] : [terminal] });
          return () => {
            metadataListener = undefined;
          };
        }),
    }),
  );
  const archiveEngine = OrchestrationEngineService.of({
    ...engine,
    dispatch: (command, options) =>
      Effect.gen(function* () {
        if (command.type === "thread.archive.cancel" && gateNextCancel) {
          gateNextCancel = false;
          const release = yield* Deferred.make<void>();
          yield* Queue.offer(cancelRequests, release);
          yield* Deferred.await(release);
        }
        return yield* engine.dispatch(command, options);
      }),
  });
  const build = ThreadArchive.make.pipe(
    Effect.provide(dependencies),
    Effect.provideService(OrchestrationEngineService, archiveEngine),
  );
  const archive = yield* build;
  yield* archive.start().pipe(Effect.provideService(ServerActivation, Deferred.await(parked)));
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("project-create"),
    projectId: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/tmp/archive-project",
    createdAt: START,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("thread-create"),
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    branch: null,
    worktreePath: null,
    createdAt: START,
  });
  const readThread = Effect.gen(function* () {
    const result = yield* snapshots.getThreadArchiveShellById!(THREAD_ID);
    assert.equal(result._tag, "Some");
    return Option.getOrThrow(result);
  });
  const settle = engine.dispatch({
    type: "thread.auto-settle",
    commandId: CommandId.make("thread-settle"),
    threadId: THREAD_ID,
    snapshotSequence: yield* engine.latestSequence,
    settledAt: "2026-08-01T12:00:00.000Z",
  });
  const setTerminal = (busy: boolean) =>
    Effect.gen(function* () {
      terminal = {
        threadId: THREAD_ID,
        terminalId: "term-1",
        cwd: "/tmp/archive-project",
        worktreePath: null,
        status: "running",
        pid: 1234,
        exitCode: null,
        exitSignal: null,
        hasRunningSubprocess: busy,
        label: busy ? "npm run dev" : "zsh",
        updatedAt: SEVEN_DAYS,
      };
      if (metadataListener !== undefined) yield* metadataListener({ type: "upsert", terminal });
    });
  return {
    archive,
    engine,
    readThread,
    sql,
    liveness,
    nativeRequests,
    cancelRequests,
    nativeReadRequests,
    nativeWrites,
    effects,
    settle,
    rebuild: build,
    dependencies,
    activate: Deferred.succeed(parked, undefined),
    gateNative: () => {
      gateNext = true;
    },
    gateCancelCommit: () => {
      gateNextCancel = true;
    },
    gateNativeRead: () => {
      gateNextNativeRead = true;
    },
    failNative: (direction: "archive" | "restore", count = 1) => {
      failures[direction] = count;
    },
    setEnabled: (value: boolean) => {
      settings = { ...settings, sidebarAutoArchiveSettled: value };
    },
    disableAutomaticSettlement: () => {
      settings = { ...settings, sidebarAutoSettleAfterDays: null, sidebarAutoSettleOnMerge: false };
    },
    nativeArchived: () => nativeStates.get(target.continuationKey) ?? false,
    setNativeArchived: (value: boolean) => {
      nativeStates.set(target.continuationKey, value);
    },
    replaceBinding: () => {
      target = { ...target, continuationKey: "native-2", resumeCursor: { threadId: "native-2" } };
      nativeStates.set(target.continuationKey, false);
    },
    setTerminal,
    unsupportedProvider: () => {
      supportsArchive = false;
    },
    introduceWorkAtCommit: () => {
      injectLivenessAtCommit = true;
    },
  };
});

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(makeTestLayer()));

it.effect("archives at seven continuous days only when enabled, using settlement entry time", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness(false);
      yield* h.settle;
      assert.equal((yield* h.readThread).settledSince, START);
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS) - 1);
      h.setEnabled(true);
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, null);
      assert.deepEqual(h.nativeWrites, []);
      h.setEnabled(false);
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, null);
      h.setEnabled(true);
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
      assert.equal((yield* h.readThread).archiveLifecycle, null);
      assert.equal(h.nativeArchived(), true);
    }),
  ),
);

it.effect("the startup worker archives existing overdue settled conversations", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      const events = yield* h.engine.subscribeDomainEvents;
      const archivedReceipt = yield* Effect.forkChild(
        Stream.runHead(events.pipe(Stream.filter((event) => event.type === "thread.archived"))),
      );
      yield* h.activate;
      yield* Fiber.join(archivedReceipt);
      yield* h.archive.drain;
      assert.equal(h.nativeArchived(), true);
      assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
      assert.equal((yield* h.readThread).archiveLifecycle, null);
    }),
  ),
);

it.effect("archives T4 locally when its provider has no native archive capability", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      h.unsupportedProvider();
      yield* h.settle;
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
      assert.deepEqual(h.nativeWrites, []);
    }),
  ),
);

it.effect(
  "the settlement minute worker archives settled threads while automatic settlement is disabled",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        h.disableAutomaticSettlement();
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        const settlement = yield* ThreadSettlement.make.pipe(
          Effect.provide(
            Layer.mergeAll(
              h.dependencies,
              Layer.mock(GitManager)({}),
              Layer.mock(PullRequestService)({ subscribeMerges: Effect.succeed(Stream.empty) }),
              Layer.succeed(
                Crypto.Crypto,
                Crypto.make({
                  randomBytes: (size) => new Uint8Array(size),
                  digest: (_algorithm, data) => Effect.succeed(data),
                }),
              ),
              FileSystem.layerNoop({}),
            ),
          ),
          Effect.provideService(ThreadArchive.ThreadArchiveService, h.archive),
        );
        const events = yield* h.engine.subscribeDomainEvents;
        const receipt = yield* Effect.forkChild(
          Stream.runHead(events.pipe(Stream.filter((event) => event.type === "thread.archived"))),
        );
        yield* settlement.start();
        yield* Fiber.join(receipt);
        yield* settlement.drain;
        assert.equal(h.nativeArchived(), true);
        assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
        assert.equal((yield* h.readThread).archiveLifecycle, null);
      }),
    ),
);

it.effect("restores native archive when the engine's last idle guard detects new work", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      h.introduceWorkAtCommit();
      yield* h.archive.sweep;
      assert.deepEqual(
        h.nativeWrites.map((write) => write.archived),
        [true, false],
      );
      assert.equal((yield* h.readThread).archivedAt, null);
      assert.equal(h.nativeArchived(), false);
      h.liveness.clearThreadLiveness(THREAD_ID);
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
    }),
  ),
);

it.effect(
  "persists native archive failures and resumes retries after reconstructing the runtime",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        h.failNative("archive");
        yield* h.archive.sweep;
        assert.equal((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).settledOverride, "settled");
        assert.equal((yield* h.readThread).archiveLifecycle?.status, "retrying");
        assert.match((yield* h.readThread).archiveLifecycle?.lastError ?? "", /offline/);
        assert.equal(h.nativeArchived(), false);
        const restoredRuntime = yield* h.rebuild;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS) + ThreadArchive.ARCHIVE_RETRY_AFTER_MS - 1);
        yield* restoredRuntime.sweep;
        assert.deepEqual(h.nativeWrites, []);
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS) + ThreadArchive.ARCHIVE_RETRY_AFTER_MS);
        yield* restoredRuntime.sweep;
        assert.equal(h.nativeArchived(), true);
        assert.notEqual((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        assert.deepEqual(yield* h.sql`SELECT thread_id FROM thread_archive_operations`, []);
      }),
    ),
);

it.effect("keeps failed restoration archived, then restores native before making T4 Active", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      yield* h.archive.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("manual-archive"),
        threadId: THREAD_ID,
      });
      h.failNative("restore");
      const failure = yield* h.archive
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("manual-restore"),
          threadId: THREAD_ID,
        })
        .pipe(Effect.exit);
      assert.equal(failure._tag, "Failure");
      assert.notEqual((yield* h.readThread).archivedAt, null);
      assert.equal((yield* h.readThread).archiveLifecycle?.direction, "restore");
      assert.equal(h.nativeArchived(), true);
      yield* TestClock.adjust(ThreadArchive.ARCHIVE_RETRY_AFTER_MS);
      yield* h.archive.sweep;
      assert.equal((yield* h.readThread).archivedAt, null);
      assert.equal((yield* h.readThread).settledOverride, "active");
      assert.equal((yield* h.readThread).settledSince, null);
      assert.equal(h.nativeArchived(), false);
    }),
  ),
);

it.effect("manual archive stops sessions and closes terminals before native archive", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("live-session"),
        threadId: THREAD_ID,
        createdAt: START,
        session: {
          threadId: THREAD_ID,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: START,
        },
      });
      yield* h.setTerminal(true);
      yield* h.archive.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("manual-busy-archive"),
        threadId: THREAD_ID,
      });
      assert.deepEqual(h.effects, ["stop-session", "close-terminals", "native-archive"]);
      assert.equal((yield* h.readThread).session?.status, "stopped");
      assert.notEqual((yield* h.readThread).archivedAt, null);
    }),
  ),
);

it.effect(
  "defers automatic archive for background work and busy terminals, but closes idle shells",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        h.liveness.recordTaskLiveness({
          threadId: THREAD_ID,
          taskId: "server",
          taskType: "local_bash",
          status: undefined,
          kind: "started",
        });
        yield* h.archive.sweep;
        assert.deepEqual(h.nativeWrites, []);
        h.liveness.clearThreadLiveness(THREAD_ID);
        yield* h.setTerminal(true);
        yield* h.archive.sweep;
        assert.deepEqual(h.nativeWrites, []);
        yield* h.setTerminal(false);
        yield* h.archive.sweep;
        assert.equal(h.nativeArchived(), true);
        assert.notEqual((yield* h.readThread).archivedAt, null);
      }),
    ),
);

it.effect("new work cancels an in-flight archive and restores native before becoming Active", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      h.gateNative();
      const sweep = yield* Effect.forkChild(h.archive.sweep);
      const pending = yield* Queue.take(h.nativeRequests);
      assert.equal(pending.archived, true);
      const events = yield* h.engine.subscribeDomainEvents;
      const compensationReceipt = yield* Effect.forkChild(
        Stream.runHead(
          events.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.archive-lifecycle-set" &&
                event.payload.archiveLifecycle?.direction === "restore",
            ),
          ),
        ),
      );
      const resume = yield* Effect.forkChild(
        h.archive.dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make("wake-during-archive"),
          threadId: THREAD_ID,
          reason: "user",
        }),
      );
      yield* Fiber.join(compensationReceipt);
      assert.equal((yield* h.readThread).archivedAt, null);
      yield* Deferred.succeed(pending.release, undefined);
      yield* Fiber.join(sweep);
      yield* Fiber.join(resume);
      assert.equal(h.nativeWrites[0]?.archived, true);
      assert.isTrue(h.nativeWrites.slice(1).every((write) => !write.archived));
      assert.isAtLeast(h.nativeWrites.length, 2);
      assert.equal(h.nativeArchived(), false);
      assert.equal((yield* h.readThread).settledOverride, "active");
      assert.equal((yield* h.readThread).archiveLifecycle, null);
    }),
  ),
);

it.effect("uses T4 state on first binding, then mirrors later native archive and restore", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      h.setNativeArchived(true);
      yield* h.archive.reconcile;
      assert.equal(h.nativeArchived(), false);
      assert.equal((yield* h.readThread).archivedAt, null);
      yield* TestClock.adjust(1);
      h.setNativeArchived(true);
      yield* h.archive.reconcile;
      assert.notEqual((yield* h.readThread).archivedAt, null);
      yield* TestClock.adjust(1);
      h.setNativeArchived(false);
      yield* h.archive.reconcile;
      assert.equal((yield* h.readThread).archivedAt, null);
      assert.equal((yield* h.readThread).settledOverride, "active");
    }),
  ),
);

it.effect(
  "rejects a native archive observation when new work changes the thread in the same millisecond",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* h.archive.reconcile;
        const before = yield* h.readThread;
        h.setNativeArchived(true);
        h.gateNativeRead();
        const observation = yield* Effect.forkChild(h.archive.reconcile);
        const release = yield* Queue.take(h.nativeReadRequests);
        yield* h.engine.dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make("same-millisecond-work"),
          threadId: THREAD_ID,
          reason: "user",
        });
        assert.equal((yield* h.readThread).updatedAt, before.updatedAt);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(observation);
        assert.equal((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).settledOverride, "active");
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        assert.deepEqual(yield* h.sql`SELECT thread_id FROM thread_archive_operations`, []);
      }),
    ),
);

it.effect(
  "a delayed native restore confirmation preserves a newer settlement in the same millisecond",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.archive.reconcile;
        yield* h.setTerminal(true);
        h.setNativeArchived(true);
        yield* h.archive.reconcile;
        assert.equal((yield* h.readThread).archiveLifecycle?.direction, "archive");
        assert.equal((yield* h.readThread).archivedAt, null);

        h.setNativeArchived(false);
        h.gateNativeRead();
        const observation = yield* Effect.forkChild(h.archive.sweep);
        const reversal = yield* Queue.take(h.nativeReadRequests);
        h.gateNativeRead();
        yield* Deferred.succeed(reversal, undefined);
        const restore = yield* Queue.take(h.nativeReadRequests);
        assert.equal((yield* h.readThread).archiveLifecycle?.direction, "restore");
        const before = yield* h.readThread;
        yield* h.engine.dispatch({
          type: "thread.settle",
          commandId: CommandId.make("same-millisecond-settle-during-native-restore"),
          threadId: THREAD_ID,
        });
        assert.equal((yield* h.readThread).updatedAt, before.updatedAt);
        yield* Deferred.succeed(restore, undefined);
        yield* Fiber.join(observation);
        assert.equal((yield* h.readThread).settledOverride, "settled");
        assert.equal((yield* h.readThread).settledSince, START);
        assert.equal((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        assert.deepEqual(yield* h.sql`SELECT thread_id FROM thread_archive_operations`, []);
      }),
    ),
);

it.effect(
  "terminal work cancels archive, resets settlement, and fences native archive until completion",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* h.archive.reconcile;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        h.gateNative();
        const sweep = yield* Effect.forkChild(h.archive.sweep);
        const pending = yield* Queue.take(h.nativeRequests);
        const events = yield* h.engine.subscribeDomainEvents;
        const compensation = yield* Effect.forkChild(
          Stream.runHead(
            events.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.archive-lifecycle-set" &&
                  event.payload.archiveLifecycle?.direction === "restore",
              ),
            ),
          ),
        );
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const work = yield* Effect.forkChild(
          h.archive.runWithWork(
            THREAD_ID,
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(finish);
              return "terminal-finished";
            }),
          ),
        );
        yield* Fiber.join(compensation);
        yield* Deferred.succeed(pending.release, undefined);
        yield* Fiber.join(sweep);
        yield* Deferred.await(entered);
        assert.equal(h.nativeArchived(), false);
        assert.equal((yield* h.readThread).settledOverride, "active");
        assert.equal((yield* h.readThread).settledSince, null);
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        yield* h.archive.sweep;
        assert.equal((yield* h.readThread).archivedAt, null);
        h.setNativeArchived(true);
        const nativeEvents = yield* h.engine.subscribeDomainEvents;
        const queuedArchive = yield* Effect.forkChild(
          Stream.runHead(
            nativeEvents.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.archive-lifecycle-set" &&
                  event.payload.archiveLifecycle?.direction === "archive",
              ),
            ),
          ),
        );
        const reconciliation = yield* Effect.forkChild(h.archive.reconcile);
        yield* Fiber.join(queuedArchive);
        assert.equal((yield* h.readThread).archivedAt, null);
        yield* Deferred.succeed(finish, undefined);
        assert.equal(yield* Fiber.join(work), "terminal-finished");
        yield* Fiber.join(reconciliation);
        assert.notEqual((yield* h.readThread).archivedAt, null);
      }),
    ),
);

it.effect("active terminal writes do not reopen a native archive client", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const before = h.nativeWrites.length;
      assert.equal(
        yield* h.archive.runWithWork(THREAD_ID, Effect.succeed("input-written")),
        "input-written",
      );
      assert.equal(h.nativeWrites.length, before);
      assert.equal((yield* h.readThread).settledSince, null);
    }),
  ),
);

it.effect(
  "drops a queued native archive when same-millisecond work supersedes its captured sequence",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* h.archive.reconcile;
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const work = yield* Effect.forkChild(
          h.archive.runWithWork(
            THREAD_ID,
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(finish);
            }),
          ),
        );
        yield* Deferred.await(entered);
        h.setNativeArchived(true);
        const events = yield* h.engine.subscribeDomainEvents;
        const queuedArchive = yield* Effect.forkChild(
          Stream.runHead(
            events.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.archive-lifecycle-set" &&
                  event.payload.archiveLifecycle?.direction === "archive",
              ),
            ),
          ),
        );
        const reconciliation = yield* Effect.forkChild(h.archive.reconcile);
        yield* Fiber.join(queuedArchive);
        const before = yield* h.readThread;
        yield* h.engine.dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make("same-millisecond-queued-work"),
          threadId: THREAD_ID,
          reason: "user",
        });
        assert.equal((yield* h.readThread).updatedAt, before.updatedAt);
        yield* Deferred.succeed(finish, undefined);
        yield* Fiber.join(work);
        yield* Fiber.join(reconciliation);
        assert.equal((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).settledOverride, "active");
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        assert.deepEqual(yield* h.sql`SELECT thread_id FROM thread_archive_operations`, []);
      }),
    ),
);

it.effect(
  "discards a replaced archive target and restores the current binding before new work",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        h.gateNative();
        const sweep = yield* Effect.forkChild(h.archive.sweep);
        const pending = yield* Queue.take(h.nativeRequests);
        h.replaceBinding();
        yield* Deferred.succeed(pending.release, undefined);
        yield* Fiber.join(sweep);
        assert.deepEqual(h.nativeWrites, []);
        assert.equal(h.nativeArchived(), false);
        assert.equal((yield* h.readThread).archivedAt, null);
        h.setNativeArchived(true);
        yield* h.archive.dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make("wake-replaced-binding"),
          threadId: THREAD_ID,
          reason: "user",
        });
        assert.deepEqual(h.nativeWrites, [{ continuationKey: "native-2", archived: false }]);
        assert.equal(h.nativeArchived(), false);
        assert.equal((yield* h.readThread).settledOverride, "active");
        assert.equal((yield* h.readThread).archiveLifecycle, null);
        assert.deepEqual(yield* h.sql`SELECT thread_id FROM thread_archive_operations`, []);
      }),
    ),
);

it.effect(
  "a delayed cancel completion preserves the public status of a newer archive request",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        h.failNative("archive");
        const initial = yield* h.archive
          .dispatch({
            type: "thread.archive",
            commandId: CommandId.make("archive-before-cancel"),
            threadId: THREAD_ID,
          })
          .pipe(Effect.exit);
        assert.equal(initial._tag, "Failure");
        h.gateCancelCommit();
        const cancellation = yield* Effect.forkChild(
          h.archive.dispatch({
            type: "thread.archive.cancel",
            commandId: CommandId.make("delayed-cancel"),
            threadId: THREAD_ID,
          }),
        );
        const release = yield* Queue.take(h.cancelRequests);
        h.failNative("archive");
        const newer = yield* h.archive
          .dispatch({
            type: "thread.archive",
            commandId: CommandId.make("archive-after-cancel"),
            threadId: THREAD_ID,
          })
          .pipe(Effect.exit);
        assert.equal(newer._tag, "Failure");
        assert.equal((yield* h.readThread).archiveLifecycle?.operationId, "archive-after-cancel");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(cancellation);
        const publicStatus = (yield* h.readThread).archiveLifecycle;
        assert.equal(publicStatus?.operationId, "archive-after-cancel");
        assert.equal(publicStatus?.status, "retrying");
        assert.match(publicStatus?.lastError ?? "", /offline/);
        const pending = yield* h.sql<{ operation_id: string }>`
          SELECT json_extract(operation_json, '$.operationId') AS operation_id FROM thread_archive_operations
        `;
        assert.equal(pending[0]?.operation_id, "archive-after-cancel");
      }),
    ),
);

it.effect(
  "turning auto archive off while native archive is pending restores the native thread",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        h.gateNative();
        const sweep = yield* Effect.forkChild(h.archive.sweep);
        const pending = yield* Queue.take(h.nativeRequests);
        h.setEnabled(false);
        yield* Deferred.succeed(pending.release, undefined);
        yield* Fiber.join(sweep);
        assert.deepEqual(
          h.nativeWrites.map((write) => write.archived),
          [true, false],
        );
        assert.equal(h.nativeArchived(), false);
        assert.equal((yield* h.readThread).settledOverride, "settled");
        assert.equal((yield* h.readThread).archivedAt, null);
        assert.equal((yield* h.readThread).archiveLifecycle, null);
      }),
    ),
);

for (const requestKind of ["approval", "user-input"] as const) {
  it.effect(`defers automatic archive while ${requestKind} remains open`, () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.settle;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        yield* h.engine.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(`open-${requestKind}`),
          threadId: THREAD_ID,
          createdAt: SEVEN_DAYS,
          activity: {
            id: EventId.make(`${requestKind}-1`),
            tone: "approval",
            kind: `${requestKind}.requested`,
            summary: "Approval needed",
            payload: { requestId: `${requestKind}-1` },
            turnId: null,
            createdAt: SEVEN_DAYS,
          },
        });
        const thread = yield* h.readThread;
        assert.equal(
          requestKind === "approval" ? thread.hasPendingApprovals : thread.hasPendingUserInput,
          true,
        );
        yield* h.archive.sweep;
        assert.deepEqual(h.nativeWrites, []);
        assert.equal((yield* h.readThread).archivedAt, null);
      }),
    ),
  );
}
