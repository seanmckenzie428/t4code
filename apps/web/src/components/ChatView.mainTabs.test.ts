// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("Chat and Review tabs", () => {
  it("keeps both tabs in one horizontal subheader", () => {
    const source = NodeFS.readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");
    const tabsStart = source.indexOf("function MainViewTabs");
    const tabsEnd = source.indexOf("type ChatViewProps", tabsStart);

    expect(tabsStart).toBeGreaterThanOrEqual(0);
    expect(tabsEnd).toBeGreaterThan(tabsStart);

    const tabsSource = source.slice(tabsStart, tabsEnd);
    expect(tabsSource).toContain('className="flex h-10 min-h-10 shrink-0 flex-row items-center');
    expect(tabsSource).toContain('{ id: "chat" as const');
    expect(tabsSource).toContain('id: "review" as const');
    expect(tabsSource).not.toContain("surface-subheader");
  });
});
