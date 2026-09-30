import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

const HeldThreadArchiveLocks = Context.Reference<ReadonlyMap<ThreadId, number>>(
  "t3/provider/HeldThreadArchiveLocks",
  { defaultValue: () => new Map() },
);

export function makeThreadArchiveLock() {
  const locks = new Map<ThreadId, { semaphore: Semaphore.Semaphore; users: number }>();

  return <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.withFiber((fiber) =>
      Effect.gen(function* () {
        const held = yield* HeldThreadArchiveLocks;
        if (held.get(threadId) === fiber.id) return yield* effect;

        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            let lock = locks.get(threadId);
            if (!lock) {
              lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
              locks.set(threadId, lock);
            }
            lock.users += 1;
            return lock;
          }),
          (lock) =>
            lock.semaphore.withPermit(
              Effect.provideService(
                effect,
                HeldThreadArchiveLocks,
                new Map([...held, [threadId, fiber.id]]),
              ),
            ),
          (lock) =>
            Effect.sync(() => {
              lock.users -= 1;
              if (lock.users === 0) locks.delete(threadId);
            }),
        );
      }),
    );
}
