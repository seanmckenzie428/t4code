import {
  APP_COMMAND_CATALOG,
  AppCommandRegistry,
  appCommandIdForKeybinding,
  type AppCommandAvailability,
  type AppCommandId,
  type AppCommandContext,
} from "@t3tools/client-runtime/app-control";
import {
  AppActionId,
  AppCommandId as AppCommandIdSchema,
  type AppCommandInvocation,
  type KeybindingCommand,
} from "@t3tools/contracts";
import { randomHex } from "./lib/utils";

export interface WebAppCommandContext extends AppCommandContext {
  readonly environmentId: string;
}

type WebAppCommandHandler = (
  invocation: AppCommandInvocation,
  context: WebAppCommandContext,
) => unknown | Promise<unknown>;

interface WebAppCommandHost {
  readonly handler: WebAppCommandHandler;
  readonly availability?: (context: WebAppCommandContext) => AppCommandAvailability;
}

const handlers = new Map<string, WebAppCommandHost[]>();

function resolveHost(commandId: string, context: WebAppCommandContext): WebAppCommandHost | null {
  const candidates = handlers.get(commandId);
  if (!candidates) return null;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate && (candidate.availability?.(context).available ?? true)) return candidate;
  }
  return null;
}

export const webAppCommandRegistry = new AppCommandRegistry<WebAppCommandContext>(
  APP_COMMAND_CATALOG.map(({ descriptor, domain }) => ({
    descriptor,
    domain,
    availability: (context) =>
      resolveHost(descriptor.id, context) !== null
        ? ({ available: true } as const)
        : ({
            available: false,
            reason: `${descriptor.title} is not hosted by this client.`,
          } as const),
    execute: (invocation, context) => {
      const host = resolveHost(descriptor.id, context);
      if (!host) throw new Error(`${descriptor.id} is not hosted by this client.`);
      return host.handler(invocation, context);
    },
  })),
);

export function registerWebAppCommandHandler(
  commandId: AppCommandId,
  handler: WebAppCommandHandler,
  availability?: (context: WebAppCommandContext) => AppCommandAvailability,
): () => void {
  const host: WebAppCommandHost = {
    handler,
    ...(availability ? { availability } : {}),
  };
  const commandHandlers = handlers.get(commandId) ?? [];
  commandHandlers.push(host);
  handlers.set(commandId, commandHandlers);
  return () => {
    const current = handlers.get(commandId);
    if (!current) return;
    const index = current.lastIndexOf(host);
    if (index !== -1) current.splice(index, 1);
    if (current.length === 0) handlers.delete(commandId);
  };
}

export async function invokeWebAppCommand(
  commandId: AppCommandId,
  context: WebAppCommandContext,
  args: unknown = {},
): Promise<unknown> {
  return await webAppCommandRegistry.invoke(
    {
      actionId: AppActionId.make(`web-${randomHex(16)}`),
      commandId: AppCommandIdSchema.make(commandId),
      args,
    },
    context,
  );
}

export async function invokeKeybindingAppCommand(
  commandId: KeybindingCommand,
  context: Omit<WebAppCommandContext, "source">,
  args: unknown = {},
): Promise<unknown> {
  const appCommandId = appCommandIdForKeybinding(commandId);
  if (appCommandId === null) {
    throw new Error(`Keybinding command ${commandId} has no semantic app command.`);
  }
  return await invokeWebAppCommand(appCommandId, { ...context, source: "keybinding" }, args);
}
