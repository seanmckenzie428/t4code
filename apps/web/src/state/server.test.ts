import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveShortcutCommand } from "../keybindings";
import { mergeClientDefaultKeybindings } from "./server";

const modShiftSpace = {
  key: " ",
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  modKey: true,
} as const;

describe("mergeClientDefaultKeybindings", () => {
  it("backfills client defaults missing from an older server snapshot", () => {
    const merged = mergeClientDefaultKeybindings([]);

    expect(merged.some((binding) => binding.command === "quickChat.toggle")).toBe(true);
  });

  it("keeps server bindings after defaults so custom conflicts win", () => {
    const serverBindings: ResolvedKeybindingsConfig = [
      { shortcut: modShiftSpace, command: "sidebar.toggle" },
    ];
    const merged = mergeClientDefaultKeybindings(serverBindings);

    expect(
      resolveShortcutCommand(
        { ...modShiftSpace, code: "Space", type: "keydown", metaKey: true },
        merged,
        { platform: "MacIntel" },
      ),
    ).toBe("sidebar.toggle");
  });
});
