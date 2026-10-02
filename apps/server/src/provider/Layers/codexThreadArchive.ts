import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexSchema from "effect-codex-app-server/schema";

export class ProviderAdapterRequestError extends Schema.TaggedError<ProviderAdapterRequestError>()(
  "ProviderAdapterRequestError",
  { provider: Schema.String, method: Schema.String, detail: Schema.String },
) {}
import type { ProviderThreadArchiveTarget } from "../../orchestration-v2/NativeThreadArchive.ts";
export type ProviderNativeArchiveTarget = Pick<
  ProviderThreadArchiveTarget,
  "threadId" | "resumeCursor"
>;
const CodexResumeCursorSchema = Schema.Struct({ threadId: Schema.String });

export interface CodexThreadArchiveClient {
  readonly listThreads: (
    params: CodexSchema.V2ThreadListParams,
  ) => Effect.Effect<
    { readonly data: ReadonlyArray<{ readonly id: string }>; readonly nextCursor?: string | null },
    CodexErrors.CodexAppServerError | ProviderAdapterRequestError
  >;
  readonly setArchived: (
    threadId: string,
    archived: boolean,
  ) => Effect.Effect<void, CodexErrors.CodexAppServerError | ProviderAdapterRequestError>;
}

const sourceKinds: CodexSchema.V2ThreadListParams["sourceKinds"] = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];
const isResumeCursor = Schema.is(CodexResumeCursorSchema);

export const readCodexThreadArchiveStates = Effect.fn("readCodexThreadArchiveStates")(function* <
  Target extends ProviderNativeArchiveTarget,
>(client: CodexThreadArchiveClient, targets: ReadonlyArray<Target>) {
  const ownedIds = new Set(
    targets.flatMap((target) =>
      isResumeCursor(target.resumeCursor) ? [target.resumeCursor.threadId] : [],
    ),
  );
  const active = new Set<string>();
  const archived = new Set<string>();
  const complete = yield* Effect.gen(function* () {
    for (const archivedFilter of [false, true]) {
      let cursor: string | null | undefined;
      const seenCursors = new Set<string>();
      do {
        const page = yield* client.listThreads({
          archived: archivedFilter,
          sourceKinds,
          useStateDbOnly: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const thread of page.data) {
          if (ownedIds.has(thread.id)) (archivedFilter ? archived : active).add(thread.id);
        }
        cursor = page.nextCursor;
        if (cursor && seenCursors.has(cursor)) return false;
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
    }
    return true;
  }).pipe(Effect.orElseSucceed(() => false));

  return targets.map((target) => {
    const nativeId = isResumeCursor(target.resumeCursor) ? target.resumeCursor.threadId : undefined;
    const isActive = nativeId !== undefined && active.has(nativeId);
    const isArchived = nativeId !== undefined && archived.has(nativeId);
    return {
      target,
      state:
        !complete || isActive === isArchived
          ? ("unknown" as const)
          : isArchived
            ? ("archived" as const)
            : ("active" as const),
    };
  });
});

export const setCodexThreadArchived = Effect.fn("setCodexThreadArchived")(function* (
  client: CodexThreadArchiveClient,
  target: ProviderNativeArchiveTarget,
  archived: boolean,
) {
  if (!isResumeCursor(target.resumeCursor)) {
    return yield* new ProviderAdapterRequestError({
      provider: "codex",
      method: archived ? "thread/archive" : "thread/unarchive",
      detail: "No Codex native thread id is persisted for this conversation.",
    });
  }
  const desiredState = archived ? "archived" : "active";
  const current = yield* readCodexThreadArchiveStates(client, [target]);
  if (current[0]?.state === desiredState) return;

  yield* client.setArchived(target.resumeCursor.threadId, archived);
  const confirmed = yield* readCodexThreadArchiveStates(client, [target]);
  if (confirmed[0]?.state !== desiredState) {
    return yield* new ProviderAdapterRequestError({
      provider: "codex",
      method: archived ? "thread/archive" : "thread/unarchive",
      detail: "Codex did not confirm the requested native archive state.",
    });
  }
});
