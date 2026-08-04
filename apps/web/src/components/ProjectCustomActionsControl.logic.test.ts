import { describe, expect, it } from "vite-plus/test";
import type { ProjectCustomAction } from "@t3tools/contracts";

import {
  deleteProjectCustomAction,
  projectCustomActionPresentation,
  setProjectCustomActionPlacement,
} from "./ProjectCustomActionsControl.logic";

const actions: ReadonlyArray<ProjectCustomAction> = [
  {
    id: "admin",
    name: "Admin",
    icon: "play",
    placement: "menu",
    commandId: "ui.external-url.open",
    args: { url: "https://dev.admin.lotus.localhost" },
  },
  {
    id: "tableplus",
    name: "TablePlus",
    icon: "play",
    placement: "toolbar",
    commandId: "script.run",
    args: { scriptId: "lotus-tableplus-dev" },
  },
];

describe("project custom action presentation", () => {
  it("keeps every action in the menu and renders only user-pinned actions in the toolbar", () => {
    expect(projectCustomActionPresentation(actions)).toEqual({
      menu: actions,
      toolbar: [actions[1]],
    });
  });

  it("pins and unpins through the user-owned placement update", () => {
    const pinned = setProjectCustomActionPlacement(actions, "admin", "toolbar");
    expect(pinned?.[0]?.placement).toBe("toolbar");
    expect(setProjectCustomActionPlacement(pinned ?? [], "admin", "menu")?.[0]?.placement).toBe(
      "menu",
    );
  });

  it("deletes the selected project action without changing the target", () => {
    expect(deleteProjectCustomAction(actions, "admin")).toEqual([actions[1]]);
  });
});
