import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeThreadArchiveLock } from "./threadArchiveLock.ts";

it.effect("nested calls share the current fiber's lifecycle fence", () =>
  Effect.gen(function* () {
    const lock = makeThreadArchiveLock();
    const threadId = ThreadId.make("nested");
    const result = yield* lock(threadId, lock(threadId, Effect.succeed("resumed")));
    assert.equal(result, "resumed");
  }),
);

it.effect("serializes child fibers but lets unrelated threads progress", () =>
  Effect.gen(function* () {
    const lock = makeThreadArchiveLock();
    const threadId = ThreadId.make("owned");
    const childWaiting = yield* Deferred.make<void>();
    const childEntered = yield* Deferred.make<void>();
    let entered = false;
    const child = yield* lock(
      threadId,
      Effect.gen(function* () {
        const child = yield* Effect.gen(function* () {
          yield* Deferred.succeed(childWaiting, undefined);
          yield* lock(
            threadId,
            Effect.sync(() => {
              entered = true;
            }).pipe(Effect.andThen(Deferred.succeed(childEntered, undefined))),
          );
        }).pipe(Effect.forkChild);
        yield* Deferred.await(childWaiting);
        yield* lock(ThreadId.make("other"), Effect.void);
        assert.equal(entered, false);
        return child;
      }),
    );
    yield* Deferred.await(childEntered);
    yield* Fiber.join(child);
    assert.equal(entered, true);
  }),
);
