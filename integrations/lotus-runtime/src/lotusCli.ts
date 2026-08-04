// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Standalone extension process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import type { JsonRecord, LotusCommandOptions, LotusCommandResult, LotusRunner } from "./types.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const DEFAULT_READ_TIMEOUT_MS = 30_000;
export const DEFAULT_MUTATION_TIMEOUT_MS = 30 * 60_000;

export class LotusCliError extends Error {
  readonly kind: "unavailable" | "command-failed" | "malformed-output" | "oversized-output";
  readonly argv: ReadonlyArray<string>;

  constructor(input: {
    readonly kind: LotusCliError["kind"];
    readonly message: string;
    readonly argv: ReadonlyArray<string>;
    readonly cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "LotusCliError";
    this.kind = input.kind;
    this.argv = input.argv;
  }
}

export const nodeLotusRunner: LotusRunner = {
  run: async (executable, args, options = {}) => {
    try {
      const result = await execFile(executable, [...args], {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: MAX_JSON_BYTES,
        timeout: options.timeoutMs,
        signal: options.signal,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
      const code =
        typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
      throw new LotusCliError({
        kind: code === "ENOENT" ? "unavailable" : "command-failed",
        message:
          code === "ENOENT"
            ? "Lotus Runtime CLI is not installed or is not available on PATH."
            : "Lotus Runtime command failed.",
        argv: [executable, ...args],
        cause,
      });
    }
  },
};

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseBoundedJson = (stdout: string, argv: ReadonlyArray<string>): unknown => {
  if (Buffer.byteLength(stdout, "utf8") > MAX_JSON_BYTES) {
    throw new LotusCliError({
      kind: "oversized-output",
      message: "Lotus Runtime JSON exceeded the 2 MiB extension limit.",
      argv,
    });
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    throw new LotusCliError({
      kind: "malformed-output",
      message: "Lotus Runtime returned malformed JSON.",
      argv,
      cause,
    });
  }
};

export class LotusCli {
  readonly #runner: LotusRunner;
  readonly #executable: string;

  constructor(input: { readonly runner?: LotusRunner; readonly executable?: string } = {}) {
    this.#runner = input.runner ?? nodeLotusRunner;
    this.#executable = input.executable ?? "lotus";
  }

  runJson(
    args: ReadonlyArray<string>,
    options: LotusCommandOptions & { readonly mutation?: boolean } = {},
  ): Promise<unknown> {
    const jsonArgs = args.includes("--json") ? [...args] : [...args, "--json"];
    const argv = [this.#executable, ...jsonArgs];
    return this.#runner
      .run(this.#executable, jsonArgs, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs:
          options.timeoutMs ??
          (options.mutation === true ? DEFAULT_MUTATION_TIMEOUT_MS : DEFAULT_READ_TIMEOUT_MS),
      })
      .then(({ stdout }: LotusCommandResult) => parseBoundedJson(stdout, argv))
      .catch((cause: unknown) => {
        if (cause instanceof LotusCliError) throw cause;
        const code =
          typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
        throw new LotusCliError({
          kind: code === "ENOENT" ? "unavailable" : "command-failed",
          message:
            code === "ENOENT"
              ? "Lotus Runtime CLI is not installed or is not available on PATH."
              : "Lotus Runtime command failed.",
          argv,
          cause,
        });
      });
  }
}
