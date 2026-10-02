import { ThreadId } from "@t3tools/contracts";
import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as CodexErrors from "effect-codex-app-server/errors";

import type { ProviderNativeArchiveTarget } from "./codexThreadArchive.ts";
import {
  readCodexThreadArchiveStates,
  setCodexThreadArchived,
  type CodexThreadArchiveClient,
} from "./codexThreadArchive.ts";

const target = (id: string): ProviderNativeArchiveTarget => ({
  threadId: ThreadId.make(`t4-${id}`),
  resumeCursor: { threadId: id },
});
const rejection = new CodexErrors.CodexAppServerRequestError({
  code: -32603,
  errorMessage: "native failure",
});

it.effect("finds owned threads across both paginated archive buckets", () =>
  Effect.gen(function* () {
    const listThreads = vi.fn<CodexThreadArchiveClient["listThreads"]>((params) => {
      assert.equal(params.useStateDbOnly, true);
      assert.isTrue(params.sourceKinds?.includes("appServer"));
      if (!params.cursor) {
        return Effect.succeed({ data: [{ id: "unowned" }], nextCursor: "next" });
      }
      return Effect.succeed({
        data: [{ id: params.archived ? "archived-root" : "active-root" }, { id: "both" }],
        nextCursor: null,
      });
    });
    const targets = [
      target("active-root"),
      target("archived-root"),
      target("missing"),
      target("both"),
    ];
    const states = yield* readCodexThreadArchiveStates(
      { listThreads, setArchived: () => Effect.void },
      targets,
    );
    assert.deepEqual(
      states.map((result) => result.state),
      ["active", "archived", "unknown", "unknown"],
    );
    assert.equal(listThreads.mock.calls.length, 4);
  }),
);

it.effect("keeps states unknown after an incomplete or looping listing", () =>
  Effect.gen(function* () {
    for (const failure of ["error", "loop"]) {
      const listThreads: CodexThreadArchiveClient["listThreads"] = (params) =>
        params.cursor && failure === "error"
          ? Effect.fail(rejection)
          : Effect.succeed({ data: [{ id: "root" }], nextCursor: "same" });
      const states = yield* readCodexThreadArchiveStates(
        { listThreads, setArchived: () => Effect.void },
        [target("root")],
      );
      assert.equal(states[0]?.state, "unknown");
    }
  }),
);

it.effect("does not call archive when the desired native state already exists", () =>
  Effect.gen(function* () {
    const setArchived = vi.fn<CodexThreadArchiveClient["setArchived"]>(() => Effect.void);
    const listThreads: CodexThreadArchiveClient["listThreads"] = (params) =>
      Effect.succeed({ data: params.archived ? [{ id: "root" }] : [], nextCursor: null });
    yield* setCodexThreadArchived({ listThreads, setArchived }, target("root"), true);
    assert.equal(setArchived.mock.calls.length, 0);
  }),
);

it.effect("confirms archive and restoration through fresh native listings", () =>
  Effect.gen(function* () {
    let archived = false;
    const client: CodexThreadArchiveClient = {
      listThreads: (params) =>
        Effect.succeed({
          data: params.archived === archived ? [{ id: "root" }] : [],
          nextCursor: null,
        }),
      setArchived: (id, next) =>
        Effect.sync(() => {
          assert.equal(id, "root");
          archived = next;
        }),
    };
    yield* setCodexThreadArchived(client, target("root"), true);
    assert.equal(archived, true);
    yield* setCodexThreadArchived(client, target("root"), false);
    assert.equal(archived, false);
  }),
);

it.effect("native errors and unconfirmed changes fail instead of pretending success", () =>
  Effect.gen(function* () {
    const listThreads: CodexThreadArchiveClient["listThreads"] = (params) =>
      Effect.succeed({ data: params.archived ? [] : [{ id: "root" }], nextCursor: null });
    const failed = yield* setCodexThreadArchived(
      { listThreads, setArchived: () => Effect.fail(rejection) },
      target("root"),
      true,
    ).pipe(Effect.result);
    assert.isTrue(Result.isFailure(failed));
    const unchanged = yield* setCodexThreadArchived(
      { listThreads, setArchived: () => Effect.void },
      target("root"),
      true,
    ).pipe(Effect.result);
    assert.isTrue(Result.isFailure(unchanged));
  }),
);
