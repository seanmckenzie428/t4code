import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as NativeArchive from "./NativeThreadArchive.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Registry from "./ProviderAdapterRegistry.ts";
import { type ProviderAdapterV2Shape } from "./ProviderAdapter.ts";

const driver = ProviderDriverKind.make("codex");
const firstId = ProviderInstanceId.make("codex-owner");
const secondId = ProviderInstanceId.make("codex-other");
const now = DateTime.makeUnsafe("2026-10-01T00:00:00Z");

function makeHarness(sharedHome = false) {
  const reads: Array<{ instanceId: ProviderInstanceId; count: number }> = [];
  const sets: Array<{ instanceId: ProviderInstanceId; archived: boolean }> = [];
  const failures = new Set<ProviderInstanceId>();
  const homes = new Map([
    [firstId, sharedHome ? "codex:shared" : "codex:first"],
    [secondId, sharedHome ? "codex:shared" : "codex:second"],
  ]);
  let opens = 0;
  const adapter = (instanceId: ProviderInstanceId): ProviderAdapterV2Shape => ({
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: () =>
      Effect.sync(() => {
        opens++;
      }).pipe(Effect.andThen(Effect.die("Archive must not start a provider"))),
    nativeArchive: {
      readStates: (targets) =>
        Effect.gen(function* () {
          reads.push({ instanceId, count: targets.length });
          if (failures.has(instanceId))
            return yield* new NativeArchive.NativeThreadArchiveError({
              cause: new Error("Native home unavailable"),
            });
          return targets.map((target) => ({
            target,
            state: instanceId === firstId ? ("archived" as const) : ("active" as const),
          }));
        }),
      setArchived: (_target, archived) =>
        Effect.sync(() => {
          sets.push({ instanceId, archived });
        }),
    },
  });
  const registry = Registry.ProviderAdapterRegistryV2.of({
    get: (instanceId) => Effect.succeed(adapter(instanceId)),
    list: () => Effect.succeed([firstId, secondId]),
    getMetadata: (instanceId) =>
      Effect.succeed({
        driver,
        continuationKey: homes.get(instanceId)!,
        enabled: true,
        capabilities: CodexProviderCapabilitiesV2,
      }),
  });
  const stores = ProjectionStore.layer.pipe(Layer.provide(SqlitePersistenceMemory));
  const layer = NativeArchive.layer.pipe(
    Layer.provideMerge(stores),
    Layer.provide(Layer.succeed(Registry.ProviderAdapterRegistryV2, registry)),
  );
  return { reads, sets, homes, failures, layer, opens: () => opens };
}

const seed = Effect.fn("seedNativeArchiveTarget")(function* (
  id: string,
  instanceId: ProviderInstanceId,
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(id);
  const providerThreadId = ProviderThreadId.make(`provider:${id}:${instanceId}`);
  yield* store.apply({
    id: EventId.make(`thread:${id}`),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      id: threadId,
      projectId: ProjectId.make("project"),
      kind: "project",
      title: id,
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/workspace",
      activeProviderThreadId: providerThreadId,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* store.apply({
    id: EventId.make(`provider:${id}`),
    type: "provider-thread.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: providerThreadId,
      appThreadId: threadId,
      driver,
      providerInstanceId: instanceId,
      providerSessionId: null,
      ownerNodeId: null,
      nativeThreadRef: { driver, nativeId: `native:${id}`, strength: "strong" },
      nativeConversationHeadRef: null,
      status: "not_loaded",
      firstRunOrdinal: null,
      lastRunOrdinal: null,
      handoffIds: [],
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  const native = yield* NativeArchive.NativeThreadArchive;
  const target = yield* native.getThreadArchiveTarget(threadId);
  assert.isDefined(target);
  return target!;
});

it.effect("routes stopped bindings to each owner without starting providers", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const native = yield* NativeArchive.NativeThreadArchive;
    const targets = [
      yield* seed("one", firstId),
      yield* seed("two", firstId),
      yield* seed("three", secondId),
    ];
    assert.deepEqual(
      (yield* native.readNativeArchiveStates(targets)).map((row) => row.state),
      ["archived", "archived", "active"],
    );
    assert.deepEqual(h.reads, [
      { instanceId: firstId, count: 2 },
      { instanceId: secondId, count: 1 },
    ]);
    assert.equal(h.opens(), 0);
    assert.equal(targets[0]?.continuationKey, "codex:first");
  }).pipe(Effect.provide(h.layer));
});

it.effect("rejects stale native targets after instance or continuation changes", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const native = yield* NativeArchive.NativeThreadArchive;
    const target = yield* seed("switched", firstId);
    yield* seed("switched", secondId);
    assert.isFalse(yield* native.setNativeThreadArchived(target, true));
    assert.equal((yield* native.readNativeArchiveStates([target]))[0]?.state, "unknown");
    const current = yield* native.getThreadArchiveTarget(target.threadId);
    assert.isDefined(current);
    h.homes.set(secondId, "codex:replacement-home");
    assert.isFalse(yield* native.setNativeThreadArchived(current!, true));
    assert.deepEqual(h.sets, []);
  }).pipe(Effect.provide(h.layer));
});

it.effect("keeps another native home observable when one probe fails", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const native = yield* NativeArchive.NativeThreadArchive;
    const targets = [yield* seed("failed", firstId), yield* seed("healthy", secondId)];
    h.failures.add(firstId);
    assert.deepEqual(
      (yield* native.readNativeArchiveStates(targets)).map((row) => row.state),
      ["unknown", "active"],
    );
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "scans one native home once across configured instances and shares the reentrant fence",
  () => {
    const h = makeHarness(true);
    return Effect.gen(function* () {
      const native = yield* NativeArchive.NativeThreadArchive;
      const targets = [yield* seed("shared-one", firstId), yield* seed("shared-two", secondId)];
      assert.deepEqual(
        (yield* native.readNativeArchiveStates(targets)).map((row) => row.state),
        ["archived", "archived"],
      );
      assert.deepEqual(h.reads, [{ instanceId: firstId, count: 2 }]);
      assert.isTrue(
        yield* native.withThreadArchiveLock(
          targets[0]!.threadId,
          native.setNativeThreadArchived(targets[0]!, false),
        ),
      );
      assert.deepEqual(h.sets, [{ instanceId: firstId, archived: false }]);
    }).pipe(Effect.provide(h.layer));
  },
);
