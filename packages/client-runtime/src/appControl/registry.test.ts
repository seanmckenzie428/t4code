import {
  AppActionId,
  AppCommandDescriptor,
  AppCommandId,
  AppCommandInvocation,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  APP_COMMAND_CATALOG,
  APP_COMMAND_IDS,
  appCommandIdForKeybinding,
  isAppCommandId,
} from "./catalog.ts";
import { AppCommandRegistry, AppCommandRegistryError, type AppCommandContext } from "./registry.ts";

const context: AppCommandContext = {
  environmentId: "environment-1",
  projectId: "project-1",
  threadId: "thread-1",
  source: "palette",
};

const descriptor = AppCommandDescriptor.make({
  id: AppCommandId.make("test.rename"),
  version: 1,
  owner: "server",
  title: "Rename test",
  description: "Renames a test entity.",
  risk: "mutate",
  requiredGrant: "test:mutate",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  outputSchema: {},
});

const invocation = (args: unknown): AppCommandInvocation =>
  AppCommandInvocation.make({
    actionId: AppActionId.make("action-1"),
    commandId: descriptor.id,
    args,
  });

describe("AppCommandRegistry", () => {
  it("validates arguments and executes the registered semantic handler", async () => {
    const received: unknown[] = [];
    const registry = new AppCommandRegistry([
      {
        descriptor,
        domain: "project",
        execute: (request) => {
          received.push(request.args);
          return { renamed: true };
        },
      },
    ]);

    await expect(registry.invoke(invocation({ name: "New name" }), context)).resolves.toEqual({
      renamed: true,
    });
    expect(received).toEqual([{ name: "New name" }]);
    await expect(registry.invoke(invocation({}), context)).rejects.toMatchObject({
      code: "invalid-arguments",
    });
    await expect(
      registry.invoke(invocation({ name: "New name", secret: "nope" }), context),
    ).rejects.toMatchObject({ code: "invalid-arguments" });
  });

  it("blocks unavailable commands before execution", async () => {
    const registry = new AppCommandRegistry([
      {
        descriptor,
        domain: "project",
        availability: () => ({ available: false, reason: "No selected project." }),
        execute: () => {
          throw new Error("must not execute");
        },
      },
    ]);

    await expect(registry.invoke(invocation({ name: "New name" }), context)).rejects.toEqual(
      expect.objectContaining({
        code: "unavailable",
        message: "No selected project.",
      }),
    );
    expect(registry.list(context, { includeUnavailable: false })).toEqual([]);
  });

  it("rejects duplicate and unknown commands with typed errors", () => {
    const registry = new AppCommandRegistry([
      { descriptor, domain: "project", execute: () => undefined },
    ]);
    expect(() =>
      registry.register({ descriptor, domain: "project", execute: () => undefined }),
    ).toThrow(AppCommandRegistryError);
    expect(() => registry.availability("missing", context)).toThrow(
      expect.objectContaining({ code: "unknown-command" }),
    );
  });
});

describe("APP_COMMAND_CATALOG", () => {
  it("publishes unique, policy-complete V1 descriptors", () => {
    expect(new Set(APP_COMMAND_IDS).size).toBe(APP_COMMAND_IDS.length);
    for (const { descriptor: entry } of APP_COMMAND_CATALOG) {
      expect(entry.version).toBe(1);
      expect(entry.title).not.toBe("");
      expect(entry.description).not.toBe("");
      expect(entry.inputSchema).toBeTypeOf("object");
      expect(entry.outputSchema).toBeTypeOf("object");
    }
  });

  it("never exposes approval, user-input, credential, auth, grant, RPC, or DB commands", () => {
    const forbidden = [
      "approval",
      "user-input",
      "credential",
      "secret",
      "pairing",
      "auth",
      "grant",
      "rpc",
      "database",
    ];
    for (const commandId of APP_COMMAND_IDS) {
      expect(forbidden.some((fragment) => commandId.includes(fragment))).toBe(false);
      expect(isAppCommandId(commandId)).toBe(true);
    }
    expect(isAppCommandId("approval.respond")).toBe(false);
  });

  it("makes destructive commands non-grantable", () => {
    const destructive = APP_COMMAND_CATALOG.filter(
      ({ descriptor: entry }) => entry.risk === "destructive",
    );
    expect(destructive.length).toBeGreaterThan(0);
    expect(destructive.every(({ descriptor: entry }) => entry.requiredGrant === null)).toBe(true);
  });

  it("registers external URL opening as a strict client-owned external command", () => {
    const entry = APP_COMMAND_CATALOG.find(({ id }) => id === "ui.external-url.open");
    expect(entry?.descriptor).toMatchObject({ owner: "client", risk: "external" });
    expect(entry?.descriptor.inputSchema).toMatchObject({
      type: "object",
      required: ["url"],
      additionalProperties: false,
    });
  });

  it("routes imported scripts to the focused client terminal host", () => {
    const entry = APP_COMMAND_CATALOG.find(({ id }) => id === "script.run");
    expect(entry?.descriptor).toMatchObject({ owner: "client", risk: "external" });
    expect(entry?.descriptor.inputSchema).toMatchObject({
      type: "object",
      required: ["scriptId"],
      additionalProperties: false,
    });
  });

  it("registers project terminal-action import as a confirmed server action", () => {
    const entry = APP_COMMAND_CATALOG.find(({ id }) => id === "script.import");
    expect(entry?.descriptor).toMatchObject({
      owner: "server",
      risk: "external",
      requiredGrant: null,
    });
    expect(entry?.descriptor.inputSchema).toMatchObject({
      type: "object",
      required: ["projectId", "script"],
      additionalProperties: false,
    });
  });

  it("maps every shipped keybinding family to a registered semantic command", () => {
    const commands = [
      "sidebar.toggle",
      "assistant.toggle",
      "terminal.toggle",
      "terminal.split",
      "terminal.splitVertical",
      "terminal.new",
      "terminal.close",
      "rightPanel.toggle",
      "diff.toggle",
      "preview.toggle",
      "preview.refresh",
      "preview.focusUrl",
      "preview.zoomIn",
      "preview.zoomOut",
      "preview.resetZoom",
      "commandPalette.toggle",
      "filePicker.toggle",
      "projectSearch.toggle",
      "composer.stash",
      "chat.new",
      "chat.newLocal",
      "editor.openFavorite",
      "modelPicker.toggle",
      "modelPicker.jump.9",
      "thread.previous",
      "thread.next",
      "thread.jump.9",
      "script.dev.run",
    ];
    for (const keybinding of commands) {
      const commandId = appCommandIdForKeybinding(keybinding);
      expect(commandId, keybinding).not.toBeNull();
      expect(isAppCommandId(commandId ?? ""), keybinding).toBe(true);
    }
  });
});

it("keeps agent project-action proposals menu-only", () => {
  const entry = APP_COMMAND_CATALOG.find(({ id }) => id === "project.action.upsert");
  expect(entry?.descriptor).toMatchObject({ owner: "server", risk: "external" });
  const actionSchema = (
    entry?.descriptor.inputSchema as {
      properties?: { action?: { properties?: Record<string, unknown> } };
    }
  ).properties?.action?.properties;
  expect(actionSchema).toHaveProperty("commandId");
  expect(actionSchema).not.toHaveProperty("placement");
  expect(actionSchema?.icon).toMatchObject({
    type: "string",
    enum: expect.arrayContaining([
      "external-link",
      "terminal",
      "database",
      "dashboard",
      "git-branch",
    ]),
  });
});
