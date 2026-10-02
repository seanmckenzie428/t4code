import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import { cli, makeCli, resolveCliName } from "./binCli.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const runCli = (args: ReadonlyArray<string>, command = cli) =>
  Command.runWith(command, { version: "0.0.0" })(args);
const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

it.layer(NodeServices.layer)("Pilot CLI identity", (it) => {
  it("resolves pilot as canonical and preserves t4 and t3 aliases", () => {
    assert.equal(resolveCliName("/usr/local/bin/pilot"), "pilot");
    assert.equal(resolveCliName("/usr/local/bin/t4"), "t4");
    assert.equal(resolveCliName("/usr/local/bin/t3"), "t3");
    assert.equal(resolveCliName("C:\\tools\\pilot.exe"), "pilot");
    assert.equal(resolveCliName("C:\\tools\\t4.exe"), "t4");
    assert.equal(resolveCliName("C:\\tools\\t3.exe"), "t3");
    assert.equal(
      resolveCliName(
        "/Applications/Pilot.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
      ),
      "pilot",
    );
    assert.equal(resolveCliName(undefined), "pilot");
  });

  it.effect.each(["pilot", "t4", "t3"] as const)(
    "keeps %s help and command parsing usable",
    (commandName) =>
      Effect.gen(function* () {
        const command = makeCli({ cloudEnabled: false, commandName });
        const { output } = yield* captureStdout(runCli(["--help"], command));
        assert.include(output, commandName);
        assert.include(output, "Run the Pilot server.");
        const error = yield* runCli(["connect", "status"], command).pipe(
          Effect.provide(CliRuntimeLayer),
          Effect.flip,
        );
        if (!CliError.isCliError(error)) {
          assert.fail(`Expected CliError, got ${String(error)}`);
        }
        if (error._tag !== "ShowHelp") {
          assert.fail(`Expected ShowHelp, got ${error._tag}`);
        }
        assert.deepEqual(error.commandPath, [commandName, "connect"]);
      }),
  );
});
