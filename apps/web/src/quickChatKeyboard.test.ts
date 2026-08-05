import { describe, expect, it } from "vite-plus/test";

import { isQuickChatCloseEvent } from "./quickChatKeyboard";

describe("Quick Chat keyboard", () => {
  it("closes an open popup on Escape", () => {
    expect(isQuickChatCloseEvent({ key: "Escape", defaultPrevented: false }, true)).toBe(true);
  });

  it("leaves closed or already-handled surfaces alone", () => {
    expect(isQuickChatCloseEvent({ key: "Escape", defaultPrevented: false }, false)).toBe(false);
    expect(isQuickChatCloseEvent({ key: "Escape", defaultPrevented: true }, true)).toBe(false);
    expect(isQuickChatCloseEvent({ key: "Enter", defaultPrevented: false }, true)).toBe(false);
  });
});
