import {
  CommandId,
  IsoDateTime,
  OrchestrationClientOrigin,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type TerminalSummary,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProviderValidationError } from "../provider/Errors.ts";
import {
  ProviderService,
  ProviderThreadArchiveTarget,
} from "../provider/Services/ProviderService.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ThreadBackgroundLivenessService } from "./ThreadBackgroundLiveness.ts";

export const AUTO_ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
export const ARCHIVE_RETRY_AFTER_MS = 5 * 60 * 1_000;

export class ThreadArchiveError extends Schema.TaggedError<ThreadArchiveError>()(
  "ThreadArchiveError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

const ArchiveOperation = Schema.Struct({
  operationId: Schema.String,
  threadId: ThreadId,
  commandId: CommandId,
  direction: Schema.Literals(["archive", "restore"]),
  source: Schema.Literals(["manual", "auto", "native", "bootstrap", "compensate"]),
  target: Schema.NullOr(ProviderThreadArchiveTarget),
  settledSince: Schema.NullOr(IsoDateTime),
  requestedAt: IsoDateTime,
  nextAttemptAt: IsoDateTime,
  status: Schema.Literals(["pending", "retrying"]),
  lastError: Schema.NullOr(Schema.String),
  origin: Schema.NullOr(OrchestrationClientOrigin),
  observationSequence: Schema.optional(Schema.Number),
});
type ArchiveOperation = typeof ArchiveOperation.Type;
type ArchiveSource = ArchiveOperation["source"];
const ArchiveOperationJson = Schema.fromJsonString(ArchiveOperation);
const decodeOperation = Schema.decodeUnknownEffect(ArchiveOperationJson);
const encodeOperation = Schema.encodeSync(ArchiveOperationJson);
const encodeTargetKey = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export function isAutoArchiveDue(
  thread: Pick<OrchestrationThreadShell, "archivedAt" | "settledOverride" | "settledSince">,
  now: string,
): boolean {
  return (
    thread.archivedAt === null &&
    thread.settledOverride === "settled" &&
    thread.settledSince !== null &&
    DateTime.toEpochMillis(DateTime.makeUnsafe(now)) -
      DateTime.toEpochMillis(DateTime.makeUnsafe(thread.settledSince)) >=
      AUTO_ARCHIVE_AFTER_MS
  );
}

export class ThreadArchiveService extends Context.Service<
  ThreadArchiveService,
  {
    readonly dispatch: (
      command: OrchestrationCommand,
      options?: { readonly origin?: OrchestrationClientOrigin },
    ) => Effect.Effect<{ sequence: number }, ThreadArchiveError>;
    readonly prepareForWork: (threadId: ThreadId) => Effect.Effect<void, ThreadArchiveError>;
    readonly runWithWork: <A, E, R>(
      threadId: ThreadId,
      work: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ThreadArchiveError, R>;
    readonly sweep: Effect.Effect<void>;
    readonly reconcile: Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/ThreadArchiveService") {}

/** Native work stays outside the decider; durable intent precedes every side effect. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderService;
  const settingsService = yield* ServerSettingsService;
  const terminals = yield* TerminalManager;
  const liveness = yield* ThreadBackgroundLivenessService;
  const terminalStates = new Map<string, TerminalSummary>();

  const wrapError = (cause: unknown) =>
    new ThreadArchiveError({ message: "Conversation archive operation failed", cause });
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const retryAt = (now: string) =>
    DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(now), { minutes: 5 }));
  const targetKey = (target: ProviderThreadArchiveTarget) =>
    encodeTargetKey([target.providerInstanceId, target.continuationKey, target.resumeCursor]);
  const locked = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    providers.withThreadArchiveLock?.(threadId, effect) ?? effect;

  const readOperation = Effect.fn("ThreadArchiveService.readOperation")(function* (
    threadId: ThreadId,
  ) {
    const rows = yield* sql<{ operation_json: string }>`
      SELECT operation_json FROM thread_archive_operations WHERE thread_id = ${threadId}
    `.pipe(Effect.mapError(wrapError));
    if (rows[0] === undefined) return null;
    return yield* decodeOperation(rows[0].operation_json).pipe(Effect.mapError(wrapError));
  });

  const writeOperation = Effect.fn("ThreadArchiveService.writeOperation")(function* (
    operation: ArchiveOperation,
    expected: ArchiveOperation | null,
  ) {
    if (expected !== null) {
      const updated = yield* sql<{ thread_id: string }>`
        UPDATE thread_archive_operations
        SET operation_json = ${encodeOperation(operation)}, next_attempt_at = ${operation.nextAttemptAt}
        WHERE thread_id = ${operation.threadId} AND operation_json = ${encodeOperation(expected)}
        RETURNING thread_id
      `.pipe(Effect.mapError(wrapError));
      if (updated.length === 0) return false;
    } else
      yield* sql`
      INSERT INTO thread_archive_operations (thread_id, operation_json, next_attempt_at)
      VALUES (${operation.threadId}, ${encodeOperation(operation)}, ${operation.nextAttemptAt})
      ON CONFLICT(thread_id) DO NOTHING
    `.pipe(Effect.mapError(wrapError));
    const saved = yield* readOperation(operation.threadId);
    yield* publishStatus(operation.threadId);
    return saved?.operationId === operation.operationId && saved.direction === operation.direction;
  });

  const getThread = Effect.fn("ThreadArchiveService.getThread")(function* (threadId: ThreadId) {
    if (snapshots.getThreadArchiveShellById !== undefined) {
      return Option.getOrNull(
        yield* snapshots.getThreadArchiveShellById(threadId).pipe(Effect.mapError(wrapError)),
      );
    }
    const active = yield* snapshots.getThreadShellById(threadId).pipe(Effect.mapError(wrapError));
    if (Option.isSome(active)) return active.value;
    const archived = yield* snapshots.getArchivedShellSnapshot().pipe(Effect.mapError(wrapError));
    return archived.threads.find((thread) => thread.id === threadId) ?? null;
  });

  const publishStatus = Effect.fn("ThreadArchiveService.publishStatus")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<void, ThreadArchiveError> {
    // SQL intent can change while an RPC holds the provider fence. Always
    // project the newest intent, including a cancellation, rather than the
    // caller's older copy. Guarded events prevent delayed clears clobbering it.
    while (true) {
      const operation = yield* readOperation(threadId);
      const thread = yield* getThread(threadId);
      if (thread === null) return;
      const status = thread.archiveLifecycle;
      if (
        operation === null
          ? status === null
          : status?.operationId === operation.operationId &&
            status.direction === operation.direction &&
            status.status === operation.status &&
            status.lastError === operation.lastError
      )
        return;
      yield* engine
        .dispatch({
          type: "thread.archive-lifecycle.set",
          commandId: CommandId.make(`archive-status:${threadId}:${yield* engine.latestSequence}`),
          threadId,
          expectedOperationId: status?.operationId ?? null,
          archiveLifecycle:
            operation === null
              ? null
              : {
                  operationId: operation.operationId,
                  direction: operation.direction,
                  status: operation.status,
                  lastError: operation.lastError,
                },
        })
        .pipe(Effect.mapError(wrapError));
    }
  });

  const clearOperation = Effect.fn("ThreadArchiveService.clearOperation")(function* (
    operation: ArchiveOperation,
  ) {
    const current = yield* readOperation(operation.threadId);
    if (current?.operationId !== operation.operationId || current.direction !== operation.direction)
      return;
    yield* sql`DELETE FROM thread_archive_operations WHERE thread_id = ${operation.threadId} AND operation_json = ${encodeOperation(current)}`.pipe(
      Effect.mapError(wrapError),
    );
    yield* publishStatus(operation.threadId);
  });

  const markInitialized = Effect.fn("ThreadArchiveService.markInitialized")(function* (
    operation: ArchiveOperation,
  ) {
    if (operation.target === null) return;
    yield* sql`
      INSERT INTO thread_archive_native_bindings (thread_id, target_key, initialized_at)
      VALUES (${operation.threadId}, ${targetKey(operation.target)}, ${yield* nowIso})
      ON CONFLICT(thread_id, target_key) DO NOTHING
    `.pipe(Effect.mapError(wrapError));
  });

  const safelyIdle = Effect.fn("ThreadArchiveService.safelyIdle")(function* (
    thread: OrchestrationThreadShell,
  ) {
    if (thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
    if (thread.latestTurn?.state === "running" || thread.session?.activeTurnId != null)
      return false;
    if (thread.session?.status === "starting" || thread.session?.status === "running") return false;
    if (liveness.getThreadBackgroundLiveness(thread.id) !== null) return false;
    // closeIdle re-inspects subprocesses under the terminal lock, including
    // input races. Any surviving open terminal prevents background archive.
    yield* terminals.closeIdle({ threadId: thread.id });
    return !Array.from(terminalStates.values()).some(
      (terminal) =>
        terminal.threadId === thread.id &&
        (terminal.status === "starting" || terminal.status === "running"),
    );
  });

  const request = Effect.fn("ThreadArchiveService.request")(function* (
    threadId: ThreadId,
    direction: ArchiveOperation["direction"],
    source: ArchiveSource,
    commandId: CommandId,
    target?: ProviderThreadArchiveTarget | null,
    origin?: OrchestrationClientOrigin,
    observationSequence?: number,
  ) {
    const thread = yield* getThread(threadId);
    if (thread === null)
      return yield* new ThreadArchiveError({ message: "Conversation no longer exists" });
    const existing = yield* readOperation(threadId);
    if (existing !== null && (source === "auto" || source === "native" || source === "bootstrap"))
      return existing;
    if (existing?.direction === direction && existing.source === source) return existing;
    const now = yield* nowIso;
    const savedTarget =
      target === undefined
        ? ((yield* (providers.getThreadArchiveTarget?.(threadId) ?? Effect.succeed(undefined)).pipe(
            Effect.mapError(wrapError),
          )) ?? null)
        : target;
    const operation: ArchiveOperation = {
      operationId: commandId,
      threadId,
      commandId,
      direction,
      source,
      target: savedTarget,
      settledSince: source === "auto" ? thread.settledSince : null,
      requestedAt: now,
      nextAttemptAt: now,
      status: "pending",
      lastError: null,
      origin: origin ?? null,
      ...(observationSequence === undefined ? {} : { observationSequence }),
    };
    const written = yield* writeOperation(operation, existing);
    return written ? operation : ((yield* readOperation(threadId)) ?? operation);
  });

  const compensate = Effect.fn("ThreadArchiveService.compensate")(function* (
    operation: ArchiveOperation,
    archived: boolean,
  ) {
    const replacement: ArchiveOperation = {
      ...operation,
      operationId: `${operation.operationId}:cancel`,
      commandId: CommandId.make(`${operation.commandId}:cancel`),
      direction: archived ? "archive" : "restore",
      source: "compensate",
      nextAttemptAt: yield* nowIso,
      status: "pending",
      lastError: null,
    };
    const written = yield* writeOperation(replacement, operation);
    return written ? replacement : ((yield* readOperation(operation.threadId)) ?? replacement);
  });

  const observationChanged = Effect.fn("ThreadArchiveService.observationChanged")(function* (
    operation: ArchiveOperation,
  ) {
    if (operation.observationSequence === undefined) return false;
    const changed = yield* sql<{ sequence: number }>`
      SELECT sequence FROM orchestration_events
      WHERE aggregate_kind = 'thread' AND stream_id = ${operation.threadId}
        AND sequence > ${operation.observationSequence}
        AND event_type != 'thread.archive-lifecycle-set'
        AND (event_type != 'thread.session-set' OR command_id IS NULL
          OR command_id != ${`archive-stop:${operation.operationId}`})
      LIMIT 1
    `.pipe(Effect.mapError(wrapError));
    return changed.length !== 0;
  });

  const perform = Effect.fn("ThreadArchiveService.perform")(function* (
    operation: ArchiveOperation,
  ): Effect.fn.Return<{ sequence: number } | null, ThreadArchiveError> {
    const current = yield* readOperation(operation.threadId);
    if (
      current?.operationId !== operation.operationId ||
      current.direction !== operation.direction
    ) {
      return null;
    }
    if (
      (operation.source === "native" || operation.source === "bootstrap") &&
      operation.observationSequence !== undefined
    ) {
      if (yield* observationChanged(operation)) {
        yield* clearOperation(operation);
        return null;
      }
    }
    if (providers.getThreadArchiveTarget !== undefined) {
      const target = yield* providers
        .getThreadArchiveTarget(operation.threadId)
        .pipe(Effect.mapError(wrapError));
      if (
        operation.target !== null &&
        (target === undefined || targetKey(target) !== targetKey(operation.target))
      ) {
        // A saved intent belongs to its captured native conversation. Never
        // retarget it after an account, home, or session binding changes.
        yield* clearOperation(operation);
        return null;
      }
      if (operation.target === null && target !== undefined) {
        const replacement = { ...operation, target };
        if (yield* writeOperation(replacement, operation)) return yield* process(replacement);
        return null;
      }
    }
    let thread = yield* getThread(operation.threadId);
    if (thread === null) {
      yield* sql`DELETE FROM thread_archive_operations WHERE thread_id = ${operation.threadId}`.pipe(
        Effect.mapError(wrapError),
      );
      return null;
    }
    if (operation.source === "auto") {
      const settings = resolveProjectSettings(
        yield* settingsService.getSettings.pipe(Effect.mapError(wrapError)),
        thread.projectId,
      ).settings;
      if (
        !settings.sidebarAutoArchiveSettled ||
        thread.settledSince !== operation.settledSince ||
        !isAutoArchiveDue(thread, yield* nowIso)
      ) {
        const replacement = yield* compensate(operation, thread.archivedAt !== null);
        return yield* process(replacement);
      }
    }
    const backgroundArchive =
      operation.direction === "archive" &&
      (operation.source === "auto" || operation.source === "native");
    if (
      operation.source === "native" &&
      operation.target !== null &&
      providers.readNativeArchiveStates !== undefined
    ) {
      const observations = yield* providers
        .readNativeArchiveStates([operation.target])
        .pipe(Effect.mapError(wrapError));
      const state = observations[0]?.state ?? "unknown";
      if (state === "unknown") return null;
      if ((state === "archived") !== (operation.direction === "archive")) {
        const now = yield* nowIso;
        const replacement: ArchiveOperation = {
          ...operation,
          operationId: `${operation.operationId}:observed:${now}`,
          commandId: CommandId.make(`${operation.commandId}:observed:${now}`),
          direction: state === "archived" ? "archive" : "restore",
          nextAttemptAt: now,
          status: "pending",
          lastError: null,
        };
        if (yield* writeOperation(replacement, operation)) return yield* process(replacement);
        return null;
      }
    }
    if (backgroundArchive && !(yield* safelyIdle(thread))) return null;

    if (operation.direction === "archive" && operation.source !== "compensate") {
      // Manual archive intentionally stops work. Background sources reach
      // this point only after their idle gate, then recheck at commit.
      const live = (yield* providers.listSessions()).find(
        (session) =>
          session.threadId === operation.threadId &&
          session.status !== "closed" &&
          session.status !== "error",
      );
      if ((thread.session !== null && thread.session.status !== "stopped") || live !== undefined) {
        yield* providers
          .stopSession({ threadId: operation.threadId })
          .pipe(Effect.mapError(wrapError));
        yield* engine
          .dispatch(
            {
              type: "thread.session.set",
              commandId: CommandId.make(`archive-stop:${operation.operationId}`),
              threadId: operation.threadId,
              createdAt: yield* nowIso,
              session: {
                threadId: operation.threadId,
                providerName:
                  thread.session?.providerName ??
                  live?.provider ??
                  operation.target?.provider ??
                  null,
                ...((thread.session?.providerInstanceId ??
                  live?.providerInstanceId ??
                  operation.target?.providerInstanceId) === undefined
                  ? {}
                  : {
                      providerInstanceId:
                        thread.session?.providerInstanceId ??
                        live?.providerInstanceId ??
                        operation.target!.providerInstanceId,
                    }),
                runtimeMode: thread.session?.runtimeMode ?? live?.runtimeMode ?? thread.runtimeMode,
                lastError: thread.session?.lastError ?? live?.lastError ?? null,
                status: "stopped",
                activeTurnId: null,
                updatedAt: yield* nowIso,
              },
            },
            operation.origin === null ? undefined : { origin: operation.origin },
          )
          .pipe(Effect.mapError(wrapError));
      }
      if (operation.source === "manual") {
        yield* terminals.close({ threadId: operation.threadId }).pipe(Effect.mapError(wrapError));
      }
    }

    if (
      operation.source !== "native" &&
      operation.target !== null &&
      providers.setNativeThreadArchived !== undefined
    ) {
      const applied = yield* providers
        .setNativeThreadArchived(operation.target, operation.direction === "archive")
        .pipe(Effect.mapError(wrapError));
      if (!applied) {
        const target = yield* (
          providers.getThreadArchiveTarget?.(operation.threadId) ?? Effect.succeed(undefined)
        ).pipe(Effect.mapError(wrapError));
        if (target === undefined || targetKey(target) !== targetKey(operation.target)) {
          yield* clearOperation(operation);
          return null;
        }
        return yield* new ThreadArchiveError({
          message: "Provider conversation changed before archive operation completed",
        });
      }
    }

    const afterNative = yield* readOperation(operation.threadId);
    if (
      afterNative?.operationId !== operation.operationId ||
      afterNative.direction !== operation.direction
    ) {
      if (afterNative !== null) yield* process(afterNative);
      return null;
    }
    thread = yield* getThread(operation.threadId);
    if (thread === null) return null;
    if (operation.target !== null && providers.getThreadArchiveTarget !== undefined) {
      const target = yield* providers
        .getThreadArchiveTarget(operation.threadId)
        .pipe(Effect.mapError(wrapError));
      if (target === undefined || targetKey(target) !== targetKey(operation.target)) {
        yield* clearOperation(operation);
        return null;
      }
    }
    if (backgroundArchive && !(yield* safelyIdle(thread))) {
      const replacement = yield* compensate(operation, false);
      yield* process(replacement);
      return null;
    }
    const autoStillEnabled =
      operation.source !== "auto" ||
      resolveProjectSettings(
        yield* settingsService.getSettings.pipe(Effect.mapError(wrapError)),
        thread.projectId,
      ).settings.sidebarAutoArchiveSettled;
    if (
      operation.source === "auto" &&
      (!autoStillEnabled || thread.settledSince !== operation.settledSince)
    ) {
      const replacement = yield* compensate(operation, false);
      yield* process(replacement);
      return null;
    }

    if (operation.source === "native" && (yield* observationChanged(operation))) {
      yield* clearOperation(operation);
      return null;
    }
    let result = { sequence: yield* engine.latestSequence };
    if (operation.source !== "bootstrap" && operation.source !== "compensate") {
      if (operation.direction === "archive" && thread.archivedAt === null) {
        const completion = yield* engine
          .dispatch(
            {
              type: "thread.archive",
              commandId: CommandId.make(
                `archive-complete:${operation.operationId}:${yield* engine.latestSequence}`,
              ),
              threadId: operation.threadId,
              ...(operation.source === "auto"
                ? { expectedSettledSince: operation.settledSince! }
                : {}),
              ...(backgroundArchive ? { onlyIfIdle: true } : {}),
            },
            operation.origin === null ? undefined : { origin: operation.origin },
          )
          .pipe(Effect.result);
        if (completion._tag === "Failure") {
          if (backgroundArchive) {
            const replacement = yield* compensate(operation, false);
            yield* process(replacement);
            return null;
          }
          return yield* wrapError(completion.failure);
        }
        result = completion.success;
        const committed = yield* getThread(operation.threadId);
        if (committed?.archivedAt == null) {
          const replacement = yield* compensate(operation, false);
          yield* process(replacement);
          return null;
        }
      } else if (operation.direction === "restore") {
        if (thread.archivedAt !== null) {
          result = yield* engine
            .dispatch(
              {
                type: "thread.unarchive",
                commandId: operation.commandId,
                threadId: operation.threadId,
              },
              operation.origin === null ? undefined : { origin: operation.origin },
            )
            .pipe(Effect.mapError(wrapError));
        }
        // Restoring is re-engagement, including native-origin restoration.
        result = yield* engine
          .dispatch(
            {
              type: "thread.unsettle",
              commandId: CommandId.make(`archive-unsettle:${operation.operationId}`),
              threadId: operation.threadId,
              reason: "user",
            },
            operation.origin === null ? undefined : { origin: operation.origin },
          )
          .pipe(Effect.mapError(wrapError));
      }
    }
    yield* markInitialized(operation);
    yield* clearOperation(operation);
    return result;
  });

  const process = Effect.fn("ThreadArchiveService.process")(function* (
    operation: ArchiveOperation,
  ): Effect.fn.Return<{ sequence: number } | null, ThreadArchiveError> {
    return yield* locked(operation.threadId, perform(operation)).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const current = yield* readOperation(operation.threadId);
          if (
            current?.operationId === operation.operationId &&
            current.direction === operation.direction
          ) {
            const message = error.cause instanceof Error ? error.cause.message : error.message;
            yield* writeOperation(
              {
                ...current,
                status: "retrying",
                lastError: message,
                nextAttemptAt: retryAt(yield* nowIso),
              },
              current,
            );
          }
          return yield* error;
        }),
      ),
    );
  });

  const prepareForWork = Effect.fn("ThreadArchiveService.prepareForWork")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<void, ThreadArchiveError> {
    const thread = yield* getThread(threadId);
    if (thread === null) return;
    let operation = yield* readOperation(threadId);
    if (operation !== null && operation.direction === "archive") {
      // Publish cancellation before waiting on a native archive already in
      // flight. Its completion sees this replacement and restores the target.
      operation = yield* compensate(operation, false);
    }
    if (operation === null) {
      if (
        thread.archivedAt === null &&
        (yield* providers.listSessions()).some(
          (session) =>
            session.threadId === threadId &&
            session.status !== "closed" &&
            session.status !== "error",
        )
      )
        return;
      const target = yield* (
        providers.getThreadArchiveTarget?.(threadId) ?? Effect.succeed(undefined)
      ).pipe(Effect.mapError(wrapError));
      if (target === undefined && thread.archivedAt === null) return;
      operation = yield* request(
        threadId,
        "restore",
        thread.archivedAt === null ? "compensate" : "manual",
        CommandId.make(`archive-resume:${threadId}:${yield* nowIso}`),
        target ?? null,
      );
    }
    const result = yield* process(operation);
    if (result === null) {
      if ((yield* readOperation(threadId)) !== null) {
        return yield* new ThreadArchiveError({
          message: "Conversation restoration is still pending",
        });
      }
      // An obsolete captured binding was discarded. Prepare the new owning
      // conversation before admitting work rather than carrying the old ID.
      return yield* prepareForWork(threadId);
    }
    if ((yield* getThread(threadId))?.archivedAt != null) {
      const restore = yield* request(
        threadId,
        "restore",
        "manual",
        CommandId.make(`archive-work-restore:${threadId}:${yield* engine.latestSequence}`),
      );
      yield* process(restore);
    }
  });

  const cancelArchiveForWork = Effect.fn("ThreadArchiveService.cancelArchiveForWork")(function* (
    threadId: ThreadId,
  ) {
    const pending = yield* readOperation(threadId);
    if (pending?.direction === "archive") yield* compensate(pending, false);
  });

  const runWithWork = <A, E, R>(threadId: ThreadId, work: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      // An in-flight RPC must see cancellation before this work waits on its fence.
      yield* cancelArchiveForWork(threadId);
      return yield* locked(
        threadId,
        Effect.gen(function* () {
          let thread = yield* getThread(threadId);
          if (
            thread !== null &&
            (thread.archivedAt !== null ||
              thread.settledOverride === "settled" ||
              (yield* readOperation(threadId)) !== null)
          ) {
            yield* prepareForWork(threadId);
            thread = yield* getThread(threadId);
          }
          if (thread?.settledOverride === "settled") {
            yield* engine
              .dispatch({
                type: "thread.unsettle",
                commandId: CommandId.make(
                  `archive-work:${threadId}:${yield* engine.latestSequence}`,
                ),
                threadId,
                reason: "user",
              })
              .pipe(Effect.mapError(wrapError));
          }
          return yield* work;
        }),
      );
    });

  const dispatch = Effect.fn("ThreadArchiveService.dispatch")(function* (
    command: OrchestrationCommand,
    options?: { readonly origin?: OrchestrationClientOrigin },
  ) {
    if (command.type === "thread.archive.cancel") {
      const operation = yield* readOperation(command.threadId);
      if (operation !== null) {
        const thread = yield* getThread(command.threadId);
        const replacement = yield* compensate(
          operation,
          thread?.archivedAt !== null && thread?.archivedAt !== undefined,
        );
        yield* process(replacement);
      }
      const result = yield* engine.dispatch(command, options).pipe(Effect.mapError(wrapError));
      yield* publishStatus(command.threadId);
      return result;
    }
    if (command.type === "thread.archive" || command.type === "thread.unarchive") {
      const operation = yield* request(
        command.threadId,
        command.type === "thread.archive" ? "archive" : "restore",
        "manual",
        command.commandId,
        undefined,
        options?.origin,
      );
      const result = yield* process(operation);
      const completed = yield* getThread(command.threadId);
      if (
        completed === null ||
        (completed.archivedAt !== null) !== (command.type === "thread.archive") ||
        (result === null && (yield* readOperation(command.threadId)) !== null)
      ) {
        return yield* new ThreadArchiveError({
          message: "Archive operation was cancelled by newer activity",
        });
      }
      return result ?? { sequence: yield* engine.latestSequence };
    }
    if (
      command.type === "thread.turn.start" ||
      command.type === "thread.unsettle" ||
      command.type === "thread.pin"
    ) {
      // Cancellation must become durable before waiting behind an in-flight
      // native RPC. Admission then shares the fence with archive completion.
      yield* cancelArchiveForWork(command.threadId);
      return yield* locked(
        command.threadId,
        Effect.gen(function* () {
          yield* prepareForWork(command.threadId);
          return yield* engine.dispatch(command, options).pipe(Effect.mapError(wrapError));
        }),
      );
    }
    return yield* engine.dispatch(command, options).pipe(Effect.mapError(wrapError));
  });

  const sweep = Effect.gen(function* () {
    const now = yield* nowIso;
    const settings = yield* settingsService.getSettings;
    const due = yield* sql<{ thread_id: string }>`
      SELECT thread_id FROM thread_archive_operations
      WHERE next_attempt_at <= ${now} OR json_extract(operation_json, '$.source') = 'auto'
    `;
    for (const row of due) {
      const operation = yield* readOperation(ThreadId.make(row.thread_id));
      if (operation?.source === "auto" && operation.nextAttemptAt > now) {
        const thread = yield* getThread(operation.threadId);
        if (
          thread !== null &&
          resolveProjectSettings(settings, thread.projectId).settings.sidebarAutoArchiveSettled &&
          thread.settledSince === operation.settledSince
        )
          continue;
      }
      if (operation !== null) yield* process(operation).pipe(Effect.ignoreCause({ log: true }));
    }
    const deadline = DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(now), { days: -7 }));
    const candidates = yield* sql<{ id: string }>`
      SELECT thread_id AS id FROM projection_threads
      WHERE deleted_at IS NULL AND archived_at IS NULL
        AND settled_override = 'settled' AND settled_since <= ${deadline}
    `;
    for (const row of candidates) {
      const threadId = ThreadId.make(row.id);
      const thread = yield* getThread(threadId);
      if (
        thread === null ||
        !resolveProjectSettings(settings, thread.projectId).settings.sidebarAutoArchiveSettled ||
        (yield* readOperation(threadId)) !== null
      )
        continue;
      if (!(yield* locked(threadId, safelyIdle(thread)))) continue;
      const operation = yield* request(
        threadId,
        "archive",
        "auto",
        CommandId.make(`auto-archive:${threadId}:${thread.settledSince}`),
      );
      yield* process(operation).pipe(Effect.ignoreCause({ log: true }));
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("thread archive sweep failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const reconcile = Effect.gen(function* () {
    if (
      providers.getThreadArchiveTarget === undefined ||
      providers.readNativeArchiveStates === undefined
    )
      return;
    const observationSequence = yield* engine.latestSequence;
    const threads = yield* sql<{
      thread_id: string;
      updated_at: string;
      archived_at: string | null;
    }>`
      SELECT thread_id, updated_at, archived_at FROM projection_threads WHERE deleted_at IS NULL
    `;
    const targets = [];
    const byThread = new Map<ThreadId, { updatedAt: string; archivedAt: string | null }>();
    for (const row of threads) {
      const threadId = ThreadId.make(row.thread_id);
      if ((yield* readOperation(threadId)) !== null) continue;
      const target = yield* providers
        .getThreadArchiveTarget(threadId)
        .pipe(Effect.mapError(wrapError));
      if (target === undefined) continue;
      targets.push(target);
      byThread.set(threadId, { updatedAt: row.updated_at, archivedAt: row.archived_at });
    }
    const states = yield* providers.readNativeArchiveStates(targets);
    for (const { target, state } of states) {
      if (state === "unknown") continue;
      const before = byThread.get(target.threadId);
      const current = yield* getThread(target.threadId);
      if (
        before === undefined ||
        current === null ||
        current.updatedAt !== before.updatedAt ||
        current.archivedAt !== before.archivedAt ||
        (yield* readOperation(target.threadId)) !== null
      )
        continue;
      // Same-millisecond events can share updatedAt. Fence observations with
      // the durable sequence as well as their projected state and binding.
      const changed = yield* sql<{ sequence: number }>`
        SELECT sequence FROM orchestration_events
        WHERE aggregate_kind = 'thread' AND stream_id = ${target.threadId}
          AND sequence > ${observationSequence}
        LIMIT 1
      `;
      if (changed.length !== 0) continue;
      const latestTarget = yield* providers.getThreadArchiveTarget(target.threadId);
      if (latestTarget === undefined || targetKey(latestTarget) !== targetKey(target)) continue;
      const initialized = yield* sql<{ initialized_at: string }>`
        SELECT initialized_at FROM thread_archive_native_bindings
        WHERE thread_id = ${target.threadId} AND target_key = ${targetKey(target)}
      `;
      const desiredArchived = current.archivedAt !== null;
      if (initialized.length === 0) {
        const operation = yield* request(
          target.threadId,
          desiredArchived ? "archive" : "restore",
          "bootstrap",
          CommandId.make(`archive-align:${target.threadId}:${yield* nowIso}`),
          target,
          undefined,
          observationSequence,
        );
        yield* process(operation).pipe(Effect.ignoreCause({ log: true }));
      } else if ((state === "archived") !== desiredArchived) {
        const operation = yield* request(
          target.threadId,
          state === "archived" ? "archive" : "restore",
          "native",
          CommandId.make(`archive-observed:${target.threadId}:${yield* nowIso}`),
          target,
          undefined,
          observationSequence,
        );
        yield* process(operation).pipe(Effect.ignoreCause({ log: true }));
      }
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("native archive reconciliation failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const worker = yield* makeDrainableWorker((kind: "sweep" | "reconcile" | ThreadId) => {
    if (kind === "sweep") return sweep;
    if (kind === "reconcile") return reconcile;
    return prepareForWork(kind).pipe(Effect.ignoreCause({ log: true }));
  });

  if (providers.registerThreadResumePreparation !== undefined) {
    yield* providers.registerThreadResumePreparation((threadId) =>
      prepareForWork(threadId).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderValidationError({
              operation: "restore-before-resume",
              issue: cause.message,
              cause,
            }),
        ),
      ),
    );
  }

  const start = Effect.fn("ThreadArchiveService.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          terminalStates.clear();
          for (const terminal of event.terminals)
            terminalStates.set(`${terminal.threadId}:${terminal.terminalId}`, terminal);
        } else if (event.type === "remove") {
          terminalStates.delete(`${event.threadId}:${event.terminalId}`);
        } else {
          terminalStates.set(
            `${event.terminal.threadId}:${event.terminal.terminalId}`,
            event.terminal,
          );
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const events = yield* engine.subscribeDomainEvents;
    const statuses = yield* sql<{ thread_id: string }>`
      SELECT thread_id FROM thread_archive_operations
      UNION SELECT thread_id FROM projection_threads WHERE deleted_at IS NULL AND archive_lifecycle_json IS NOT NULL
    `.pipe(Effect.orDie);
    for (const row of statuses)
      yield* publishStatus(ThreadId.make(row.thread_id)).pipe(Effect.ignoreCause({ log: true }));
    yield* forkParked(
      Stream.runForEach(events, (event) => {
        switch (event.type) {
          case "thread.unsettled":
            return worker.enqueue(event.payload.threadId);
          case "thread.deleted":
            return sql`DELETE FROM thread_archive_operations WHERE thread_id = ${event.payload.threadId}`.pipe(
              Effect.ignoreCause({ log: true }),
            );
          default:
            return Effect.void;
        }
      }),
    );
    yield* forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue("sweep");
        yield* worker.drain;
      }),
    );
    yield* forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue("reconcile");
        yield* worker.drain;
      }).pipe(Effect.repeat(Schedule.spaced("5 minutes")), Effect.asVoid),
    );
  });

  return ThreadArchiveService.of({
    dispatch,
    prepareForWork,
    runWithWork,
    sweep,
    reconcile,
    start,
    drain: worker.drain,
  });
});

export const layer = Layer.effect(ThreadArchiveService, make);
