import { describe, expect, it } from "vite-plus/test";

import {
  PREVIEW_HIGHLIGHT_GLOBAL,
  buildPreviewHighlightClearExpression,
  buildPreviewHighlightExpression,
} from "./PreviewHighlights.ts";

describe("preview highlight expressions", () => {
  it("builds passive, isolated, event-driven callouts without target mutation", () => {
    const expression = buildPreviewHighlightExpression({
      mode: "apply",
      highlightId: "highlight-1",
      callouts: [
        {
          locator: "role=button[name='Send']",
          title: "Send",
          explanation: "Submits the message",
          color: "blue",
        },
      ],
      scrollTo: 1,
    });

    expect(expression).toContain('host.setAttribute("aria-hidden", "true")');
    expect(expression).toContain("host.inert = true");
    expect(expression).toContain('pointerEvents: "none"');
    expect(expression).toContain('attachShadow({ mode: "closed" })');
    expect(expression).toContain('host.setAttribute("popover", "manual")');
    expect(expression).toContain("textContent = callout.title");
    expect(expression).toContain('window.addEventListener("scroll", schedule, true)');
    expect(expression).toContain("new ResizeObserver(schedule)");
    expect(expression).toContain("new MutationObserver(schedule)");
    expect(expression).not.toContain("target.style");
    expect(expression).not.toContain("target.setAttribute");
  });

  it("JSON-encodes text and makes cleanup ID-scoped and reload-safe", () => {
    const expression = buildPreviewHighlightExpression({
      mode: "update",
      highlightId: 'highlight-"quoted',
      callouts: [{ locator: "text=</script>", explanation: "<b>text only</b>" }],
    });
    const clear = buildPreviewHighlightClearExpression('highlight-"quoted');

    expect(expression).toContain(JSON.stringify(PREVIEW_HIGHLIGHT_GLOBAL));
    expect(expression).toContain('highlight-\\"quoted');
    expect(expression).toContain("current?.id !== payload.highlightId");
    expect(clear).toContain("if (!current || current.id !==");
    expect(clear).toContain("return { cleared: false }");
  });
});
