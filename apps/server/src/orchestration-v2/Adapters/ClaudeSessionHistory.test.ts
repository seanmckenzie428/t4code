import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcessSpawner } from "effect/unstable/process";
import { assert, it } from "@effect/vitest";
import {
  resolveLegacyClaudeAssistantCursor,
  readClaudeSessionHistory,
  type ClaudeHistoryMessage,
} from "./ClaudeSessionHistory.ts";

const message = (
  type: ClaudeHistoryMessage["type"],
  uuid: string,
  content: unknown = uuid,
): ClaudeHistoryMessage => ({
  type,
  uuid,
  parent_tool_use_id: null,
  message: { content },
});

it("uses the saved native user boundary, ignoring tool results and steering prompts", () => {
  const history = [
    message("user", "u1"),
    message("assistant", "tool-use"),
    message("user", "tool-result", [{ type: "tool_result", tool_use_id: "tool" }]),
    message("user", "steer"),
    message("assistant", "a1"),
    message("system", "notice"),
    message("user", "u2"),
    message("assistant", "a2"),
  ];
  assert.equal(resolveLegacyClaudeAssistantCursor(history, ["u1", "u2"], "u1"), "a1");
  assert.isUndefined(resolveLegacyClaudeAssistantCursor(history, [null, null], "u1"));
});

it("infers older null boundaries only when the native human count agrees", () => {
  const history = [message("user", "u1"), message("assistant", "a1"), message("user", "u2")];
  assert.equal(resolveLegacyClaudeAssistantCursor(history, [null, null], "u1"), "a1");
  assert.isUndefined(resolveLegacyClaudeAssistantCursor(history, [null, null, null], "u1"));
});

it("rejects turns from another provider session or a compacted boundary", () => {
  const history = [message("user", "u1"), message("assistant", "a1"), message("user", "u2")];
  assert.isUndefined(resolveLegacyClaudeAssistantCursor(history, ["u1", "u2"], "foreign-turn"));
  assert.isUndefined(resolveLegacyClaudeAssistantCursor(history, ["missing", "u2"], "missing"));
  assert.isUndefined(resolveLegacyClaudeAssistantCursor(history, ["u1", "missing"], "u1"));
});

it.effect("runs the isolated SDK worker module with the managed provider home", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pilot-claude-history-home-" });
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      let captured = false;
      const messages = yield* readClaudeSessionHistory({
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        dir: home,
        environment: { ...process.env, CLAUDE_CONFIG_DIR: home },
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            assert.equal(command._tag, "StandardCommand");
            if (command._tag === "StandardCommand") {
              assert.match(command.args[0]!, /claude-history-worker\.ts$/);
              assert.equal(command.args[1], "getSessionMessages");
              assert.equal(command.options.env?.CLAUDE_CONFIG_DIR, home);
              assert.equal(command.options.env?.ELECTRON_RUN_AS_NODE, "1");
              captured = true;
            }
            return spawner.spawn(command);
          }),
        ),
      );
      assert.isTrue(captured);
      assert.deepEqual(messages, []);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
