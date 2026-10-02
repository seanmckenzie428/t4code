import type * as CodexSchema from "effect-codex-app-server/schema";
import type * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Effect from "effect/Effect";

/** Codex 0.156 replaces count-based rollback with a boundary in paginated history. */
export const revertCodexThread = Effect.fn("revertCodexThread")(function* (
  client: Pick<CodexClient.CodexAppServerClient["Service"], "request">,
  threadId: string,
  target: number | { readonly afterTurnId: string | null },
) {
  let remaining = typeof target === "number" ? target : Number.POSITIVE_INFINITY;
  let foundNativeBoundary = false;
  let beforeTurnId: string | undefined;
  let cursor: string | null = null;
  const visited = new Set<string | null>();
  while (remaining > 0) {
    if (visited.has(cursor)) {
      return yield* CodexErrors.CodexAppServerRequestError.internalError(
        "Thread history pagination repeated a cursor.",
        undefined,
        { method: "thread/turns/list", operation: "decode-payload" },
      );
    }
    visited.add(cursor);
    const page: CodexSchema.V2ThreadTurnsListResponse = yield* client.request("thread/turns/list", {
      threadId,
      cursor,
      limit: Math.min(remaining, 100),
      sortDirection: "desc",
      itemsView: "summary",
    });
    for (const turn of page.data) {
      if (typeof target !== "number" && target.afterTurnId === turn.id) {
        foundNativeBoundary = true;
        break;
      }
      beforeTurnId = turn.id;
      if (--remaining === 0) break;
    }
    if (foundNativeBoundary) break;
    cursor = page.nextCursor ?? null;
    if (cursor === null) break;
  }
  if (typeof target !== "number" && target.afterTurnId !== null && !foundNativeBoundary) {
    return yield* CodexErrors.CodexAppServerRequestError.internalError(
      "The selected turn is not in the current Codex conversation.",
      undefined,
      { method: "thread/turns/list", operation: "decode-payload" },
    );
  }
  return beforeTurnId === undefined
    ? yield* client.request("thread/read", { threadId, includeTurns: false })
    : yield* client.request("thread/revert", { threadId, beforeTurnId });
});
