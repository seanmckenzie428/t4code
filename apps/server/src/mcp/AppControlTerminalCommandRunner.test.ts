import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { make, resolveScopedCommandCwd } from "./AppControlTerminalCommandRunner.ts";

it.effect("resolves relative command directories inside the current workspace", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-",
    });
    const nested = path.join(root, "packages", "app");
    yield* fileSystem.makeDirectory(nested, { recursive: true });

    const cwd = yield* resolveScopedCommandCwd({ allowedRoot: root, cwd: "packages/app" });

    expect(cwd).toBe(yield* fileSystem.realPath(nested));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a command directory outside the current workspace", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-",
    });
    const outside = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-outside-",
    });

    const result = yield* resolveScopedCommandCwd({ allowedRoot: root, cwd: outside }).pipe(
      Effect.result,
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "forbidden" },
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a symlink that escapes the current workspace", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-",
    });
    const outside = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-outside-",
    });
    const link = path.join(root, "escape");
    yield* fileSystem.symlink(outside, link);

    const result = yield* resolveScopedCommandCwd({ allowedRoot: root, cwd: link }).pipe(
      Effect.result,
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "forbidden" },
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs through the bounded one-shot process path", () => {
  let processInput: ProcessRunner.ProcessRunInput | undefined;
  const processRunner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        processInput = input;
        return {
          stdout: "opened\n",
          stderr: "",
          code: 0 as never,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
  });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-app-control-command-",
    });
    const runner = yield* make;

    const output = yield* runner.run({
      command: "lotus tableplus dev",
      allowedRoot: root,
    });

    expect(processInput).toMatchObject({
      args:
        process.platform === "win32"
          ? ["/d", "/s", "/c", "lotus tableplus dev"]
          : ["-lc", "lotus tableplus dev"],
      cwd: yield* fileSystem.realPath(root),
      maxOutputBytes: 256 * 1024,
      outputMode: "truncate",
      timeoutBehavior: "timedOutResult",
    });
    expect(output).toMatchObject({ stdout: "opened\n", exitCode: 0, timedOut: false });
  }).pipe(
    Effect.scoped,
    Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
    Effect.provide(NodeServices.layer),
  );
});
