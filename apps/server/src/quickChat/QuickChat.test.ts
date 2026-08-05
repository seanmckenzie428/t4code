import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { makeQuickChatProjectId, resolveQuickChatAvailability } from "./QuickChat.ts";

describe("quick chat foundation", () => {
  it("uses an environment-scoped reserved project id", () => {
    expect(makeQuickChatProjectId(EnvironmentId.make("local"))).toBe("t3-quick-chat-project-local");
  });

  it("requires a configured model", () => {
    expect(
      resolveQuickChatAvailability({
        selection: null,
        instance: undefined,
        profileEnforcementAvailable: true,
      }).status,
    ).toBe("unavailable");
    expect(
      resolveQuickChatAvailability({
        selection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
        },
        instance: { driverKind: ProviderDriverKind.make("codex"), enabled: true },
        profileEnforcementAvailable: true,
      }).status,
    ).toBe("available");
  });

  it("requires Codex and the control-only profile", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("provider"),
      model: "model",
    };
    expect(
      resolveQuickChatAvailability({
        selection,
        instance: { driverKind: ProviderDriverKind.make("claudeAgent"), enabled: true },
        profileEnforcementAvailable: true,
      }).status,
    ).toBe("unavailable");
    expect(
      resolveQuickChatAvailability({
        selection,
        instance: { driverKind: ProviderDriverKind.make("codex"), enabled: true },
        profileEnforcementAvailable: false,
      }).status,
    ).toBe("unavailable");
  });
});
