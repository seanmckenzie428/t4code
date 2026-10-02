import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  NodeId,
  RunId,
  MessageId,
  ProviderSessionId,
  ProviderThreadId,
  RuntimeRequestId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type TerminalMetadataStreamEvent,
  type TerminalSummary,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  NativeThreadArchive,
  NativeThreadArchiveError,
  type ProviderThreadArchiveTarget,
} from "./NativeThreadArchive.ts";
import { makeThreadArchiveLock } from "../provider/threadArchiveLock.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";
import * as ApplicationEvents from "../persistence/Services/OrchestrationEventStore.ts";
import * as ArchiveAdmission from "./ThreadArchiveAdmission.ts";
import * as ThreadArchive from "./ThreadArchiveService.ts";

const START = "2026-09-01T12:00:00.000Z";
const SEVEN_DAYS = "2026-09-08T12:00:00.000Z";
const THREAD_ID = ThreadId.make("archive-thread");
const PROJECT_ID = ProjectId.make("archive-project");

const adapter = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Archive never launches a conversational provider"),
} satisfies ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const makeTestLayer = () =>
  Layer.mergeAll(
    database,
    ProjectionStore.layer.pipe(Layer.provide(database)),
    OrchestrationEventStoreLive.pipe(Layer.provide(database)),
    makeOrchestratorV2ReplayLayerWithRegistry(
      { name: "pilot-archive" },
      ProviderAdapterRegistry.makeLayer([adapter]),
      { databaseLayer: database, runEffectWorker: false },
    ).pipe(Layer.provideMerge(ArchiveAdmission.layer)),
  );

const makeHarness = Effect.fn("TestThreadArchive.makeHarness")(function* (enabled = true) {
  yield* TestClock.setTime(Date.parse(START));
  const orchestrator = yield* OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventStore = yield* ApplicationEvents.OrchestrationEventStore;
  const engine = {
    ...orchestrator,
    dispatch: (command: Parameters<typeof orchestrator.dispatch>[0]) =>
      ArchiveAdmission.withoutArchiveAdmission(orchestrator.dispatch(command)),
    latestSequence: eventStore.latestApplicationSequence,
    subscribeDomainEvents: Effect.map(eventStore.latestApplicationSequence, (afterSequence) =>
      orchestrator
        .streamStoredEventsFrom({ afterSequence })
        .pipe(Stream.map((stored) => stored.event)),
    ),
  };
  let backgroundSequence = 0;
  const setBackgroundWork = (busy: boolean) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      yield* projections.apply({
        id: EventId.make(`background-${backgroundSequence++}`),
        type: "provider-thread.updated",
        threadId: THREAD_ID,
        occurredAt: now,
        payload: {
          id: ProviderThreadId.make("archive-provider-thread"),
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: null,
          appThreadId: THREAD_ID,
          ownerNodeId: null,
          nativeThreadRef: null,
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: 1,
          lastRunOrdinal: 1,
          handoffIds: [],
          forkedFrom: null,
          pendingBackgroundTasks: busy ? [{ taskId: "watch", kind: "monitor" }] : [],
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* projections.apply({
        id: EventId.make(`background-run-${backgroundSequence++}`),
        type: "run.created",
        threadId: THREAD_ID,
        occurredAt: now,
        payload: {
          id: RunId.make("archive-background-run"),
          threadId: THREAD_ID,
          ordinal: 1,
          providerInstanceId: ProviderInstanceId.make("codex"),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          providerThreadId: ProviderThreadId.make("archive-provider-thread"),
          userMessageId: MessageId.make("archive-background-message"),
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed",
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: null,
          contextHandoffId: null,
        },
      });
      const thread = yield* projections.getThread(THREAD_ID);
      yield* projections.apply({
        id: EventId.make(`background-thread-${backgroundSequence++}`),
        type: "thread.metadata-updated",
        threadId: THREAD_ID,
        occurredAt: now,
        payload: {
          ...thread,
          activeProviderThreadId: ProviderThreadId.make("archive-provider-thread"),
        },
      });
    });
  const liveness = {
    recordTaskLiveness: (_input: unknown) => setBackgroundWork(true),
    clearThreadLiveness: (_threadId: ThreadId) => setBackgroundWork(false),
  };
  const sql = yield* SqlClient.SqlClient;
  const parked = yield* Deferred.make<void>();
  const settingsChanges = yield* Queue.unbounded<typeof DEFAULT_SERVER_SETTINGS>();
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
      subscribeChanges: Effect.succeed(Stream.fromQueue(settingsChanges)),
    }),
    Layer.mock(NativeThreadArchive)({
      withThreadArchiveLock: withLock,
      getThreadArchiveTarget: () => Effect.sync(() => (supportsArchive ? target : undefined)),
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
            return yield* new NativeThreadArchiveError({
              cause: new Error("Native provider offline"),
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
            yield* liveness
              .recordTaskLiveness({
                threadId: THREAD_ID,
                taskId: "commit-race",
                taskType: "subagent",
                status: undefined,
                kind: "started",
              })
              .pipe(Effect.orDie);
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
  const archiveEngine = OrchestratorV2.of({
    ...orchestrator,
    dispatch: (command) =>
      Effect.gen(function* () {
        if (
          command.type === "thread.archive-lifecycle.set" &&
          command.archiveLifecycle === null &&
          gateNextCancel
        ) {
          gateNextCancel = false;
          const release = yield* Deferred.make<void>();
          yield* Queue.offer(cancelRequests, release);
          yield* Deferred.await(release);
        }
        return yield* orchestrator.dispatch(command);
      }),
  });
  const sessions = Layer.mock(ProviderSessionManagerV2)({
    detach: () =>
      Effect.sync(() => {
        effects.push("stop-session");
      }),
  });
  const build = ThreadArchive.make.pipe(
    Effect.provide(Layer.merge(dependencies, sessions)),
    Effect.provideService(OrchestratorV2, archiveEngine),
  );
  const archive = yield* build;
  yield* archive.start().pipe(Effect.provideService(ServerActivation, Deferred.await(parked)));
  yield* engine.dispatch({
    type: "thread.create",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make("thread-create"),
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    branch: null,
    worktreePath: null,
  });
  const readThread = Effect.gen(function* () {
    const thread = yield* orchestrator.getThreadShell(THREAD_ID);
    assert.isNotNull(thread);
    return {
      ...thread!,
      archivedAt: thread!.archivedAt === null ? null : DateTime.formatIso(thread!.archivedAt),
      settledSince: thread!.settledSince == null ? null : DateTime.formatIso(thread!.settledSince),
      updatedAt: DateTime.formatIso(thread!.updatedAt),
    };
  });
  const settle = engine.dispatch({
    type: "thread.auto-settle",
    commandId: CommandId.make("thread-settle"),
    threadId: THREAD_ID,
    snapshotAt: DateTime.makeUnsafe(START),
    settledAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
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
    orchestrator,
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
    notifySettings: () => Queue.offer(settingsChanges, settings),
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
      const archivedReceipt = yield* Effect.forkChild({ startImmediately: true })(
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

it.effect("the independent archive worker runs while automatic settlement is disabled", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      h.disableAutomaticSettlement();
      yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
      const events = yield* h.engine.subscribeDomainEvents;
      const receipt = yield* Effect.forkChild({ startImmediately: true })(
        Stream.runHead(events.pipe(Stream.filter((event) => event.type === "thread.archived"))),
      );
      yield* h.activate;
      yield* Fiber.join(receipt);
      yield* h.archive.drain;
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
      yield* h.liveness.clearThreadLiveness(THREAD_ID);
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
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* projections.apply({
        id: EventId.make("live-session"),
        type: "provider-session.attached",
        threadId: THREAD_ID,
        occurredAt: DateTime.makeUnsafe(START),
        payload: {
          id: ProviderSessionId.make("live-session"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          status: "ready",
          cwd: "/tmp/archive-project",
          model: "gpt-5.4",
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: DateTime.makeUnsafe(START),
          updatedAt: DateTime.makeUnsafe(START),
          lastError: null,
        },
      });
      yield* h.setTerminal(true);
      yield* h.archive.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("manual-busy-archive"),
        threadId: THREAD_ID,
      });
      assert.deepEqual(h.effects, ["stop-session", "close-terminals", "native-archive"]);
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
        yield* h.liveness.recordTaskLiveness({
          threadId: THREAD_ID,
          taskId: "server",
          taskType: "local_bash",
          status: undefined,
          kind: "started",
        });
        yield* h.archive.sweep;
        assert.deepEqual(h.nativeWrites, []);
        yield* h.liveness.clearThreadLiveness(THREAD_ID);
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
      const sweep = yield* Effect.forkChild({ startImmediately: true })(h.archive.sweep);
      const pending = yield* Queue.take(h.nativeRequests);
      assert.equal(pending.archived, true);
      const events = yield* h.engine.subscribeDomainEvents;
      const compensationReceipt = yield* Effect.forkChild({ startImmediately: true })(
        Stream.runHead(
          events.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.metadata-updated" &&
                event.payload.archiveLifecycle?.direction === "restore",
            ),
          ),
        ),
      );
      const resume = yield* Effect.forkChild({ startImmediately: true })(
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
        const observation = yield* Effect.forkChild({ startImmediately: true })(
          h.archive.reconcile,
        );
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
        const observation = yield* Effect.forkChild({ startImmediately: true })(h.archive.sweep);
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
        const sweep = yield* Effect.forkChild({ startImmediately: true })(h.archive.sweep);
        const pending = yield* Queue.take(h.nativeRequests);
        const events = yield* h.engine.subscribeDomainEvents;
        const compensation = yield* Effect.forkChild({ startImmediately: true })(
          Stream.runHead(
            events.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.metadata-updated" &&
                  event.payload.archiveLifecycle?.direction === "restore",
              ),
            ),
          ),
        );
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const work = yield* Effect.forkChild({ startImmediately: true })(
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
        const queuedArchive = yield* Effect.forkChild({ startImmediately: true })(
          Stream.runHead(
            nativeEvents.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.metadata-updated" &&
                  event.payload.archiveLifecycle?.direction === "archive",
              ),
            ),
          ),
        );
        const reconciliation = yield* Effect.forkChild({ startImmediately: true })(
          h.archive.reconcile,
        );
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
        const work = yield* Effect.forkChild({ startImmediately: true })(
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
        const queuedArchive = yield* Effect.forkChild({ startImmediately: true })(
          Stream.runHead(
            events.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.metadata-updated" &&
                  event.payload.archiveLifecycle?.direction === "archive",
              ),
            ),
          ),
        );
        const reconciliation = yield* Effect.forkChild({ startImmediately: true })(
          h.archive.reconcile,
        );
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
        const sweep = yield* Effect.forkChild({ startImmediately: true })(h.archive.sweep);
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
        const cancellation = yield* Effect.forkChild({ startImmediately: true })(
          h.archive.dispatch({
            type: "thread.archive.cancel",
            operationId: (yield* h.readThread).archiveLifecycle!.operationId,
            commandId: CommandId.make("delayed-cancel"),
            threadId: THREAD_ID,
          }),
        );
        const release = yield* Queue.take(h.cancelRequests);
        h.failNative("archive");
        const events = yield* h.engine.subscribeDomainEvents;
        const newerStatus = yield* Effect.forkChild({ startImmediately: true })(
          Stream.runHead(
            events.pipe(
              Stream.filter(
                (event) =>
                  event.type === "thread.metadata-updated" &&
                  event.payload.archiveLifecycle?.operationId === "archive-after-cancel",
              ),
            ),
          ),
        );
        const newerFiber = yield* Effect.forkChild({ startImmediately: true })(
          h.archive
            .dispatch({
              type: "thread.archive",
              commandId: CommandId.make("archive-after-cancel"),
              threadId: THREAD_ID,
            })
            .pipe(Effect.exit),
        );
        yield* Fiber.join(newerStatus);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(cancellation);
        const newer = yield* Fiber.join(newerFiber);
        assert.equal(newer._tag, "Failure");
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
        const sweep = yield* Effect.forkChild({ startImmediately: true })(h.archive.sweep);
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
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const now = DateTime.makeUnsafe(SEVEN_DAYS);
        yield* projections.apply({
          id: EventId.make(`request-${requestKind}`),
          type: "runtime-request.updated",
          threadId: THREAD_ID,
          occurredAt: now,
          payload: {
            id: RuntimeRequestId.make(requestKind),
            nodeId: NodeId.make(`node-${requestKind}`),
            nativeRequestRef: null,
            providerTurnId: null,
            responseCapability: {
              type: "live",
              providerSessionId: ProviderSessionId.make("request-session"),
            },
            kind: requestKind === "approval" ? "command" : "user_input",
            status: "pending",
            createdAt: now,
            resolvedAt: null,
          },
        });
        assert.isNotNull((yield* h.readThread).pendingRuntimeRequest);
        yield* h.archive.sweep;
        assert.deepEqual(h.nativeWrites, []);
        assert.equal((yield* h.readThread).archivedAt, null);
      }),
    ),
  );
}

it.effect("fences archive against a changed settlement interval and late background work", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      const mismatched = yield* h.engine
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make("wrong-interval"),
          threadId: THREAD_ID,
          expectedSettledSince: DateTime.makeUnsafe(SEVEN_DAYS),
        })
        .pipe(Effect.exit);
      assert.equal(mismatched._tag, "Failure");
      yield* h.liveness.recordTaskLiveness({});
      const busy = yield* h.engine
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make("late-background"),
          threadId: THREAD_ID,
          expectedSettledSince: DateTime.makeUnsafe(START),
        })
        .pipe(Effect.exit);
      assert.equal(busy._tag, "Failure");
      assert.isNull((yield* h.readThread).archivedAt);
      yield* h.liveness.clearThreadLiveness(THREAD_ID);
      yield* h.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("matching-idle"),
        threadId: THREAD_ID,
        expectedSettledSince: DateTime.makeUnsafe(START),
      });
      assert.isNotNull((yield* h.readThread).archivedAt);
    }),
  ),
);

it.effect("lifecycle updates on archived threads preserve settlement and reject stale clears", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.settle;
      yield* h.archive.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-status-test"),
        threadId: THREAD_ID,
      });
      const before = yield* h.readThread;
      yield* TestClock.adjust(1);
      yield* h.engine.dispatch({
        type: "thread.archive-lifecycle.set",
        commandId: CommandId.make("status-new"),
        threadId: THREAD_ID,
        expectedOperationId: null,
        archiveLifecycle: {
          operationId: "new",
          direction: "restore",
          status: "retrying",
          lastError: "offline",
        },
      });
      yield* h.engine.dispatch({
        type: "thread.archive-lifecycle.set",
        commandId: CommandId.make("status-stale"),
        threadId: THREAD_ID,
        expectedOperationId: "old",
        archiveLifecycle: null,
      });
      assert.equal((yield* h.readThread).archiveLifecycle?.operationId, "new");
      yield* h.engine.dispatch({
        type: "thread.archive-lifecycle.set",
        commandId: CommandId.make("status-clear"),
        threadId: THREAD_ID,
        expectedOperationId: "new",
        archiveLifecycle: null,
      });
      const after = yield* h.readThread;
      assert.isNull(after.archiveLifecycle);
      assert.equal(after.archivedAt, before.archivedAt);
      assert.equal(after.settledSince, before.settledSince);
      assert.equal(after.updatedAt, before.updatedAt);
    }),
  ),
);

it.effect(
  "enabling auto archive schedules an immediate sweep independently of auto settlement",
  () =>
    run(
      Effect.gen(function* () {
        const h = yield* makeHarness(false);
        h.disableAutomaticSettlement();
        yield* h.settle;
        yield* h.activate;
        yield* h.archive.drain;
        yield* TestClock.setTime(Date.parse(SEVEN_DAYS));
        yield* h.archive.sweep;
        assert.isNull((yield* h.readThread).archivedAt);
        const events = yield* h.engine.subscribeDomainEvents;
        const receipt = yield* Effect.forkChild({ startImmediately: true })(
          Stream.runHead(events.pipe(Stream.filter((event) => event.type === "thread.archived"))),
        );
        h.setEnabled(true);
        yield* h.notifySettings();
        yield* Fiber.join(receipt);
        yield* h.archive.drain;
        assert.equal((yield* h.readThread).archivedAt, SEVEN_DAYS);
      }),
    ),
);

it.effect("direct V2 dispatch waits for native archive and rejects failed native restore", () =>
  run(
    Effect.gen(function* () {
      const h = yield* makeHarness();
      h.gateNative();
      const archiving = yield* Effect.forkChild({ startImmediately: true })(
        h.orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("external-archive"),
          threadId: THREAD_ID,
        }),
      );
      const native = yield* Queue.take(h.nativeRequests);
      assert.isNull((yield* h.readThread).archivedAt);
      assert.isUndefined(archiving.pollUnsafe());
      yield* Deferred.succeed(native.release, undefined);
      const receipt = yield* Fiber.join(archiving);
      assert.isNotEmpty(receipt.storedEvents);
      assert.isTrue(h.nativeArchived());
      h.failNative("restore");
      const restoring = yield* h.orchestrator
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("external-restore"),
          threadId: THREAD_ID,
        })
        .pipe(Effect.exit);
      assert.equal(restoring._tag, "Failure");
      assert.isNotNull((yield* h.readThread).archivedAt);
      assert.equal((yield* h.readThread).archiveLifecycle?.status, "retrying");
    }),
  ),
);
