import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { makeThreadArchiveLock } from "../provider/threadArchiveLock.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export const ProviderThreadArchiveTarget = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  provider: ProviderDriverKind,
  resumeCursor: Schema.Unknown,
  cwd: Schema.optional(Schema.String),
  continuationKey: Schema.String,
});
export type ProviderThreadArchiveTarget = typeof ProviderThreadArchiveTarget.Type;
export type NativeArchiveState = "active" | "archived" | "unknown";
export class NativeThreadArchiveError extends Schema.TaggedError<NativeThreadArchiveError>()(
  "NativeThreadArchiveError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : "Native conversation archive operation failed.";
  }
}

const key = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const registry = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const withThreadArchiveLock = makeThreadArchiveLock();
  const getThreadArchiveTarget = (
    threadId: ThreadId,
  ): Effect.Effect<ProviderThreadArchiveTarget | undefined, NativeThreadArchiveError> =>
    Effect.gen(function* () {
      const projection = yield* projections.getThreadRecords(threadId, ["providerThreads"]);
      const thread = projection.thread;
      const native = projection.providerThreads.find(
        (entry) => entry.id === thread.activeProviderThreadId,
      );
      if (native?.nativeThreadRef?.nativeId == null) return undefined;
      const adapter = yield* registry.get(native.providerInstanceId);
      if (adapter.nativeArchive === undefined) return undefined;
      const metadata = yield* (
        registry.getMetadata?.(native.providerInstanceId) ?? Effect.succeed(undefined)
      );
      if (metadata === undefined || metadata.driver !== native.driver) return undefined;
      return {
        threadId,
        providerInstanceId: native.providerInstanceId,
        provider: native.driver,
        resumeCursor: { threadId: native.nativeThreadRef.nativeId },
        ...(thread.worktreePath === null ? {} : { cwd: thread.worktreePath }),
        continuationKey: metadata.continuationKey,
      } satisfies ProviderThreadArchiveTarget;
    }).pipe(Effect.mapError((cause) => new NativeThreadArchiveError({ cause })));
  const current = (target: ProviderThreadArchiveTarget) =>
    getThreadArchiveTarget(target.threadId).pipe(
      Effect.map(
        (next) =>
          next !== undefined &&
          key([next.providerInstanceId, next.continuationKey, next.resumeCursor]) ===
            key([target.providerInstanceId, target.continuationKey, target.resumeCursor]),
      ),
    );
  const readNativeArchiveStates = (targets: ReadonlyArray<ProviderThreadArchiveTarget>) =>
    Effect.gen(function* () {
      const states = new Map<ProviderThreadArchiveTarget, NativeArchiveState>(
        targets.map((target) => [target, "unknown"]),
      );
      const groups = new Map<string, ProviderThreadArchiveTarget[]>();
      for (const target of targets) {
        if (!(yield* current(target))) continue;
        const groupKey = key([target.provider, target.continuationKey]);
        groups.set(groupKey, [...(groups.get(groupKey) ?? []), target]);
      }
      for (const group of groups.values()) {
        const owner = group[0];
        if (owner === undefined) continue;
        const adapter = yield* registry.get(owner.providerInstanceId);
        if (adapter.nativeArchive === undefined) continue;
        const observed = yield* adapter.nativeArchive
          .readStates(group)
          .pipe(Effect.orElseSucceed(() => []));
        for (const result of observed)
          if (yield* current(result.target)) states.set(result.target, result.state);
      }
      return targets.map((target) => ({ target, state: states.get(target) ?? "unknown" }));
    }).pipe(Effect.mapError((cause) => new NativeThreadArchiveError({ cause })));
  const setNativeThreadArchived = (target: ProviderThreadArchiveTarget, archived: boolean) =>
    withThreadArchiveLock(
      target.threadId,
      Effect.gen(function* () {
        if (!(yield* current(target))) return false;
        const adapter = yield* registry.get(target.providerInstanceId);
        if (adapter.nativeArchive === undefined) return false;
        yield* adapter.nativeArchive.setArchived(target, archived);
        return yield* current(target);
      }),
    ).pipe(Effect.mapError((cause) => new NativeThreadArchiveError({ cause })));
  return {
    getThreadArchiveTarget,
    readNativeArchiveStates,
    setNativeThreadArchived,
    withThreadArchiveLock,
  };
});
export class NativeThreadArchive extends Context.Service<
  NativeThreadArchive,
  Effect.Success<typeof make>
>()("t3/orchestration-v2/NativeThreadArchive") {}
export const layer = Layer.effect(NativeThreadArchive, make);
