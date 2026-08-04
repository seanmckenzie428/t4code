import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Argument, Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import * as NetService from "@t3tools/shared/Net";
import { CONNECT_PRODUCT_NAME, PRODUCT_NAME } from "@t3tools/shared/branding";
import packageJson from "../package.json" with { type: "json" };
import { authCommand } from "./cli/auth.ts";
import { connectCommand } from "./cli/connect.ts";
import { pairCommand } from "./cli/pair.ts";
import { hasCloudPublicConfig } from "./cloud/publicConfig.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";
import { serviceCommand } from "./cli/service.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

export type CliName = "t3" | "t4";

export function resolveCliName(entryPath: string | undefined): CliName {
  if (entryPath === undefined) return "t4";
  const executableName = entryPath
    .split(/[\\/]/u)
    .at(-1)
    ?.replace(/\.(?:c?m?js|exe)$/u, "");
  return executableName === "t3" ? "t3" : "t4";
}

const connectPublicConfigMissingMessage = `${CONNECT_PRODUCT_NAME} commands are unavailable: this build is missing ${CONNECT_PRODUCT_NAME} public configuration.`;

class ConnectPublicConfigMissingError extends CliError.UserError {
  override get message() {
    return connectPublicConfigMissingMessage;
  }
}

const makeConnectUnavailableCommand = (commandName: CliName) =>
  Command.make("connect", {
    command: Argument.string("command").pipe(Argument.variadic),
  }).pipe(
    Command.withDescription(
      `${CONNECT_PRODUCT_NAME} is unavailable in builds without public configuration.`,
    ),
    Command.withHidden,
    Command.withHandler(() =>
      Effect.fail(
        new CliError.ShowHelp({
          commandPath: [commandName, "connect"],
          errors: [
            new ConnectPublicConfigMissingError({ cause: connectPublicConfigMissingMessage }),
          ],
        }),
      ),
    ),
  );

export const makeCli = ({
  cloudEnabled = hasCloudPublicConfig,
  commandName = "t4",
}: { readonly cloudEnabled?: boolean; readonly commandName?: CliName } = {}) =>
  Command.make(commandName, { ...sharedServerCommandFlags }).pipe(
    Command.withDescription(`Run the ${PRODUCT_NAME} server.`),
    Command.withHandler((flags) => runServerCommand(flags)),
    Command.withSubcommands([
      startCommand,
      serveCommand,
      pairCommand,
      authCommand,
      projectCommand,
      serviceCommand,
      cloudEnabled ? connectCommand : makeConnectUnavailableCommand(commandName),
    ]),
  );

export const cli = makeCli({ commandName: resolveCliName(process.argv[1]) });

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
