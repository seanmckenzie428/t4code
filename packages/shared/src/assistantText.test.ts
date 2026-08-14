import { describe, expect, it } from "vite-plus/test";
import { stripUnsupportedAssistantDirectives } from "./assistantText";

describe("stripUnsupportedAssistantDirectives", () => {
  it("omits a complete Codex visualize transport directive", () => {
    expect(
      stripUnsupportedAssistantDirectives(
        'Before\n\n\uE200visualize\uE202{"path":"/private/tmp/diagram.html","mode":"wide"}\uE201\n\nAfter',
      ),
    ).toBe("Before\n\n\n\nAfter");
  });

  it("preserves malformed directive-like content", () => {
    const text = "\uE200visualize\uE202{not-json}\uE201";
    expect(stripUnsupportedAssistantDirectives(text)).toBe(text);
  });
});
