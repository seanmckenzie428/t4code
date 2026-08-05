import { AppViewManifest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  mergeContextAppViews,
  partitionRightPanelAppViewPlacements,
  resolveAppViewPlacements,
} from "./AppViewPlacements.logic";

const decodeManifest = Schema.decodeUnknownSync(AppViewManifest);
const manifest = (id: string, title: string, order: number) =>
  decodeManifest({
    id,
    revision: 1,
    title,
    kind: "native",
    scope: { kind: "personal" },
    placements: [{ slot: "chat-topbar", order }],
    root: { id: "root", type: "text", value: title },
  });

describe("app view placements", () => {
  it("merges personal, project, and thread views with narrow-scope precedence", () => {
    const personal = manifest("cockpit", "Personal", 0);
    const project = manifest("cockpit", "Project", 0);
    const thread = manifest("cockpit", "Thread", 0);
    expect(
      mergeContextAppViews({
        personal: { cockpit: personal },
        project: [project],
        thread: { cockpit: thread },
      }),
    ).toEqual([thread]);
  });

  it("resolves matching launchers in stable order", () => {
    const resolved = resolveAppViewPlacements(
      [manifest("later", "Later", 5), manifest("first", "First", -1)],
      "chat-topbar",
    );
    expect(resolved.map((item) => item.label)).toEqual(["First", "Later"]);
  });

  it("lets narrower scope replace a broader right-panel tile", () => {
    const personal = decodeManifest({
      ...manifest("personal", "Personal", 0),
      scope: { kind: "personal" },
      placements: [{ slot: "right-panel-launcher", mode: "replace", targetId: "browser" }],
    });
    const thread = decodeManifest({
      ...manifest("thread", "Thread", 0),
      scope: { kind: "thread", threadId: "thread-1" },
      placements: [{ slot: "right-panel-launcher", mode: "replace", targetId: "browser" }],
    });
    const placements = resolveAppViewPlacements([thread, personal], "right-panel-launcher");
    expect(
      partitionRightPanelAppViewPlacements(placements).replacements.get("browser")?.label,
    ).toBe("Thread");
  });
});
