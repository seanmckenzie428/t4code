import { describe, expect, it } from "vite-plus/test";

import {
  invokeWebAppCommand,
  invokeKeybindingAppCommand,
  registerWebAppCommandHandler,
  webAppCommandRegistry,
} from "./appCommandRegistry";

const context = { environmentId: "environment-1", source: "button" as const };

describe("web app command registry", () => {
  it("routes client entry points through the registered semantic handler", async () => {
    const calls: unknown[] = [];
    const dispose = registerWebAppCommandHandler("assistant.toggle", (invocation) => {
      calls.push(invocation.args);
      return { open: true };
    });

    await expect(invokeWebAppCommand("assistant.toggle", context)).resolves.toEqual({ open: true });
    expect(calls).toEqual([{}]);
    dispose();
  });

  it("reports commands without a mounted host as unavailable", () => {
    const command = webAppCommandRegistry
      .list(context, { includeUnavailable: true })
      .find(({ descriptor }) => descriptor.id === "assistant.focus");
    expect(command?.availability.available).toBe(false);
  });

  it("routes legacy keybinding ids through their semantic command", async () => {
    const calls: string[] = [];
    const dispose = registerWebAppCommandHandler(
      "ui.sidebar.toggle",
      (_invocation, commandContext) => {
        calls.push(commandContext.source);
      },
    );

    await invokeKeybindingAppCommand("sidebar.toggle", { environmentId: "environment-1" });
    expect(calls).toEqual(["keybinding"]);
    dispose();
  });

  it("hands a command to the newest matching host and restores the previous host", async () => {
    const calls: string[] = [];
    const disposeFirst = registerWebAppCommandHandler("assistant.toggle", () =>
      calls.push("first"),
    );
    const disposeSecond = registerWebAppCommandHandler("assistant.toggle", () =>
      calls.push("second"),
    );

    await invokeWebAppCommand("assistant.toggle", context);
    disposeSecond();
    await invokeWebAppCommand("assistant.toggle", context);
    expect(calls).toEqual(["second", "first"]);
    disposeFirst();
  });
});
