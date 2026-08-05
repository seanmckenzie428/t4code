import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  GLOBAL_ASSISTANT_PROFILE_UNAVAILABLE_REASON,
  resolveGlobalAssistantAvailability,
} from "./GlobalAssistant.ts";

const selection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6",
};

describe("global assistant availability", () => {
  it("defaults to disabled", () => {
    expect(
      resolveGlobalAssistantAvailability({
        enabled: false,
        selection: null,
        instance: undefined,
        profileEnforcementAvailable: false,
      }),
    ).toEqual({ status: "disabled" });
  });

  it("rejects non-Codex instances", () => {
    expect(
      resolveGlobalAssistantAvailability({
        enabled: true,
        selection,
        instance: { driverKind: ProviderDriverKind.make("claudeAgent"), enabled: true },
        profileEnforcementAvailable: true,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "T3 Assistant requires Codex; instance 'codex' uses 'claudeAgent'.",
    });
  });

  it("refuses startup until named permission profiles are enforced", () => {
    expect(
      resolveGlobalAssistantAvailability({
        enabled: true,
        selection,
        instance: { driverKind: ProviderDriverKind.make("codex"), enabled: true },
        profileEnforcementAvailable: false,
      }),
    ).toEqual({
      status: "unavailable",
      reason: GLOBAL_ASSISTANT_PROFILE_UNAVAILABLE_REASON,
    });
  });
});
