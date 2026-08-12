import { afterEach, describe, expect, it } from "vite-plus/test";

import { isRightPanelFocused } from "./rightPanelFocus";

class MockHTMLElement {
  isConnected = false;
  inRightPanel = false;
  tagName = "DIV";

  closest(selector: string): MockHTMLElement | null {
    return this.isConnected && this.inRightPanel && selector === "[data-preview-panel-mode]"
      ? this
      : null;
  }
}

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: Document }).document;
  } else {
    globalThis.document = originalDocument;
  }
  if (originalHTMLElement === undefined) {
    delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
  } else {
    globalThis.HTMLElement = originalHTMLElement;
  }
});

describe("isRightPanelFocused", () => {
  it("recognizes connected focus inside the right panel", () => {
    const activeElement = new MockHTMLElement();
    activeElement.isConnected = true;
    activeElement.inRightPanel = true;
    globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
    globalThis.document = { activeElement } as unknown as Document;

    expect(isRightPanelFocused()).toBe(true);
  });

  it("rejects detached or non-panel focus", () => {
    const activeElement = new MockHTMLElement();
    activeElement.inRightPanel = true;
    globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
    globalThis.document = { activeElement } as unknown as Document;

    expect(isRightPanelFocused()).toBe(false);
    activeElement.isConnected = true;
    activeElement.inRightPanel = false;
    expect(isRightPanelFocused()).toBe(false);
  });

  it("recognizes the hosted preview webview outside the panel DOM tree", () => {
    const activeElement = new MockHTMLElement();
    activeElement.isConnected = true;
    activeElement.tagName = "WEBVIEW";
    globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
    globalThis.document = { activeElement } as unknown as Document;

    expect(isRightPanelFocused()).toBe(true);
  });
});
