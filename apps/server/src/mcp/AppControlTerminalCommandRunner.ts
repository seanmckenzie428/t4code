import type { AppControlError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ProcessRunner } from "../processRunner.ts";

export interface AppControlTerminalCommandInput {
  readonly command: string;
  readonly allowedRoot: string;
  readonly cwd?: string | undefined;
}

export interface AppControlTerminalCommandOutput {
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export class AppControlTerminalCommandRunner extends Context.Service<
  AppControlTerminalCommandRunner,
  {
    readonly run: (
      input: AppControlTerminalCommandInput,
    ) => Effect.Effect<AppControlTerminalCommandOutput, AppControlError>;
  }
>()("t3/mcp/AppControlTerminalCommandRunner") {}

const controlError = (code: AppControlError["code"], message: string): AppControlError => ({
  code,
  message,
  retryable: false,
});

export const resolveScopedCommandCwd = Effect.fn(
  "AppControlTerminalCommandRunner.resolveScopedCommandCwd",
)(function* (input: Pick<AppControlTerminalCommandInput, "allowedRoot" | "cwd">) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPath = (value: string) =>
    fileSystem
      .realPath(value)
      .pipe(
        Effect.mapError(() =>
          controlError("invalid-input", "The requested terminal directory does not exist."),
        ),
      );
  const allowedRoot = yield* realPath(input.allowedRoot);
  const requested =
    input.cwd === undefined
      ? allowedRoot
      : path.isAbsolute(input.cwd)
        ? input.cwd
        : path.resolve(allowedRoot, input.cwd);
  const cwd = yield* realPath(requested);
  const relative = path.relative(allowedRoot, cwd);
  if (relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`))) {
    return yield* Effect.fail(
      controlError("forbidden", "Terminal commands must run inside the current thread workspace."),
    );
  }
  return cwd;
});

export const make = Effect.gen(function* AppControlTerminalCommandRunnerMake() {
  const processes = yield* ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const run: AppControlTerminalCommandRunner["Service"]["run"] = Effect.fn(
    "AppControlTerminalCommandRunner.run",
  )(function* (input) {
    const cwd = yield* resolveScopedCommandCwd(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const shell =
      process.platform === "win32"
        ? process.env.COMSPEC || "cmd.exe"
        : process.env.SHELL || "/bin/sh";
    const args =
      process.platform === "win32" ? ["/d", "/s", "/c", input.command] : ["-lc", input.command];
    const result = yield* processes
      .run({
        command: shell,
        args,
        cwd,
        timeout: "60 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 256 * 1024,
        outputMode: "truncate",
        truncatedMarker: "\n[T3 output truncated]",
      })
      .pipe(
        Effect.mapError(() =>
          controlError("execution-failed", "The confirmed terminal command could not be run."),
        ),
      );
    return {
      cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };
  });

  return AppControlTerminalCommandRunner.of({ run });
});

export const layer = Layer.effect(AppControlTerminalCommandRunner, make);
