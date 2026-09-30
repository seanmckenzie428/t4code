import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterAutoSettleSettingsPatch,
  planAutoSettleSettingsSync,
} from "./autoSettleSettingsSync";

const reference = {
  environmentId: EnvironmentId.make("reference"),
  capabilities: { threadAutoArchive: true },
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    sidebarAutoSettleAfterDays: 7,
    sidebarAutoSettleOnMerge: true,
    newWorktreesStartFromOrigin: false,
    continueThreadsAfterServerUpdate: false,
  },
};

describe("auto-settle settings sync", () => {
  it("ignores differences in independently configured environment settings", () => {
    const target = {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      settings: {
        ...reference.settings,
        newWorktreesStartFromOrigin: true,
        continueThreadsAfterServerUpdate: true,
        sourceControlWritingStyle: {
          ...reference.settings.sourceControlWritingStyle,
          customInstructions: "Keep this environment's writing instructions.",
        },
      },
    };

    const plan = planAutoSettleSettingsSync(reference, [target]);

    expect(plan.mismatches).toEqual([]);
    expect(plan.patch).toEqual({
      sidebarAutoSettleAfterDays: 7,
      sidebarAutoSettleOnMerge: true,
      sidebarAutoArchiveSettled: false,
    });
  });

  it("applies only auto-settle defaults when another environment differs", () => {
    const target = {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      settings: {
        ...reference.settings,
        sidebarAutoSettleAfterDays: null,
        sidebarAutoSettleOnMerge: false,
        newWorktreesStartFromOrigin: true,
        continueThreadsAfterServerUpdate: true,
        sourceControlWritingStyle: {
          ...reference.settings.sourceControlWritingStyle,
          customInstructions: "Preserve these instructions.",
        },
      },
    };

    const plan = planAutoSettleSettingsSync(reference, [target]);
    const updated = { ...target.settings, ...plan.patch };

    expect(plan.mismatches).toEqual([target]);
    expect(updated.sidebarAutoSettleAfterDays).toBe(7);
    expect(updated.sidebarAutoSettleOnMerge).toBe(true);
    expect(updated.newWorktreesStartFromOrigin).toBe(true);
    expect(updated.continueThreadsAfterServerUpdate).toBe(true);
    expect(updated.sourceControlWritingStyle).toEqual(target.settings.sourceControlWritingStyle);
  });

  it("does not compare the reference or a target without loaded settings", () => {
    const plan = planAutoSettleSettingsSync(reference, [
      { ...reference, label: "Reference" },
      { environmentId: EnvironmentId.make("loading"), label: "Loading", settings: null },
    ]);

    expect(plan.mismatches).toEqual([]);
  });

  it("notices different project checkouts on the same environment", () => {
    const projectReference = { ...reference, projectId: ProjectId.make("one") };
    const otherCheckout = {
      environmentId: reference.environmentId,
      projectId: ProjectId.make("two"),
      label: "Other checkout",
      settings: { ...reference.settings, sidebarAutoSettleAfterDays: null },
    };

    expect(planAutoSettleSettingsSync(projectReference, [otherCheckout]).mismatches).toEqual([
      otherCheckout,
    ]);
  });

  it("synchronizes an archive override independently of settlement thresholds", () => {
    const target = {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      capabilities: { threadAutoArchive: true },
      settings: { ...reference.settings, sidebarAutoArchiveSettled: true },
    };

    const plan = planAutoSettleSettingsSync(reference, [target]);

    expect(plan.mismatches).toEqual([target]);
    expect(plan.patch.sidebarAutoArchiveSettled).toBe(false);
  });

  it("retains settlement sync with older servers while omitting unsupported archive writes", () => {
    const target = {
      environmentId: EnvironmentId.make("legacy"),
      label: "Legacy",
      capabilities: { threadAutoArchive: false },
      settings: { ...reference.settings, sidebarAutoArchiveSettled: true },
    };
    expect(planAutoSettleSettingsSync(reference, [target]).mismatches).toEqual([]);
    const settlementDrift = {
      ...target,
      settings: { ...target.settings, sidebarAutoSettleAfterDays: null },
    };
    const plan = planAutoSettleSettingsSync(reference, [settlementDrift]);
    expect(plan.mismatches).toEqual([settlementDrift]);
    expect(filterAutoSettleSettingsPatch(plan.patch, target.capabilities)).toEqual({
      sidebarAutoSettleAfterDays: 7,
      sidebarAutoSettleOnMerge: true,
    });
    expect(filterAutoSettleSettingsPatch({ sidebarAutoArchiveSettled: true })).toEqual({});
  });

  it("does not push a decoded archive default from a legacy reference to a current server", () => {
    const legacyReference = { ...reference, capabilities: {} };
    const target = {
      environmentId: EnvironmentId.make("current"),
      label: "Current",
      capabilities: { threadAutoArchive: true },
      settings: { ...reference.settings, sidebarAutoArchiveSettled: true },
    };
    const plan = planAutoSettleSettingsSync(legacyReference, [target]);
    expect(plan.mismatches).toEqual([]);
    expect(plan.patch).not.toHaveProperty("sidebarAutoArchiveSettled");
  });
});
