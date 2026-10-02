import { HostProcessExecutablePath, HostProcessIsExecutable } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import { spawnAndCollect } from "../../provider/providerSnapshot.ts";

const ClaudeHistoryMessage = Schema.Struct({
  type: Schema.Literals(["user", "assistant", "system"]),
  uuid: Schema.String,
  parent_tool_use_id: Schema.NullOr(Schema.String),
  message: Schema.Unknown,
});
export type ClaudeHistoryMessage = typeof ClaudeHistoryMessage.Type;
const decodeMessages = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(ClaudeHistoryMessage)),
);
const encodeOptions = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

class ClaudeSessionHistoryError extends Schema.TaggedError<ClaudeSessionHistoryError>()(
  "ClaudeSessionHistoryError",
  { message: Schema.String },
) {}

export interface ClaudeSessionHistoryInput {
  readonly sessionId: string;
  readonly dir: string | null;
  readonly environment: NodeJS.ProcessEnv;
}

// SDK history reads process.env. A worker keeps each provider's configured home
// isolated and also works when Pilot is packaged as a single executable.
const runClaudeHistory = Effect.fn("runClaudeHistory")(function* (
  input: ClaudeSessionHistoryInput,
  method: "getSessionMessages" | "forkSession",
  options: { readonly includeSystemMessages?: boolean; readonly upToMessageId?: string },
) {
  const path = yield* Path.Path;
  const executable = yield* HostProcessExecutablePath;
  const workerArgs = (yield* HostProcessIsExecutable)
    ? ["__claude-history"]
    : [
        yield* path.fromFileUrl(
          new URL(
            import.meta.url.endsWith(".ts")
              ? "../../claude-history-worker.ts"
              : "./claude-history-worker.mjs",
            import.meta.url,
          ),
        ),
      ];
  const result = yield* spawnAndCollect(
    executable,
    ChildProcess.make(
      executable,
      [
        ...workerArgs,
        method,
        input.sessionId,
        encodeOptions({
          ...(input.dir === null ? {} : { dir: input.dir }),
          ...options,
        }),
      ],
      { env: { ...input.environment, ELECTRON_RUN_AS_NODE: "1" } },
    ),
  ).pipe(Effect.timeout("30 seconds"));
  if (result.code !== 0) {
    return yield* new ClaudeSessionHistoryError({
      message: result.stderr || "Claude session history is unavailable.",
    });
  }
  return result.stdout;
});

export const readClaudeSessionHistory = (input: ClaudeSessionHistoryInput) =>
  runClaudeHistory(input, "getSessionMessages", { includeSystemMessages: true }).pipe(
    Effect.flatMap(decodeMessages),
  );

const decodeFork = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ sessionId: Schema.String })),
);
export const forkClaudeSessionInEnvironment = (
  input: ClaudeSessionHistoryInput,
  upToMessageId?: string,
) =>
  runClaudeHistory(input, "forkSession", upToMessageId === undefined ? {} : { upToMessageId }).pipe(
    Effect.flatMap(decodeFork),
  );

const isHumanTurnStart = (message: ClaudeHistoryMessage): boolean => {
  if (message.type !== "user" || message.parent_tool_use_id !== null) return false;
  const body = message.message;
  if (typeof body !== "object" || body === null || !("content" in body)) return false;
  return (
    typeof body.content === "string" ||
    (Array.isArray(body.content) &&
      body.content.some(
        (part: unknown) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type !== "tool_result",
      ))
  );
};

/** Recover old Pilot cursors only from an exact saved native turn boundary. */
export function resolveLegacyClaudeAssistantCursor(
  messages: readonly ClaudeHistoryMessage[],
  savedTurnStarts: readonly (string | null)[],
  targetUserMessageId: string,
): string | undefined {
  const starts = messages.filter(isHumanTurnStart);
  const boundaries =
    savedTurnStarts.every((id) => id === null) && savedTurnStarts.length === starts.length
      ? starts.map((message) => message.uuid)
      : savedTurnStarts;
  if (boundaries.length === 0 || boundaries.some((id) => id === null)) return undefined;
  const targetOrdinal = boundaries.indexOf(targetUserMessageId);
  if (targetOrdinal < 0) return undefined;
  const targetStart = messages.findIndex(
    (message) => message.uuid === targetUserMessageId && isHumanTurnStart(message),
  );
  const firstRemoved = messages.findIndex(
    (message) => message.uuid === boundaries[targetOrdinal + 1],
  );
  if (targetStart < 0 || firstRemoved <= targetStart) return undefined;
  return messages
    .slice(targetStart + 1, firstRemoved)
    .findLast((message) => message.type === "assistant")?.uuid;
}
