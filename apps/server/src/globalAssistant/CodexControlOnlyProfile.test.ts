import { describe, expect, it } from "vite-plus/test";

import {
  GLOBAL_ASSISTANT_CODEX_PROFILE,
  isSupportedGlobalAssistantCodexVersion,
  verifyCodexControlOnlyConfig,
} from "./CodexControlOnlyProfile.ts";

const expected = {
  codexHome: "/state/assistant/codex-home",
  profileFile: "/state/assistant/codex-home/t3-control-only.config.toml",
  profileName: GLOBAL_ASSISTANT_CODEX_PROFILE,
} as const;

const validInput = {
  initialize: {
    codexHome: expected.codexHome,
    platformOs: "macos",
    userAgent: "codex-cli 0.146.0",
  },
  config: {
    config: { default_permissions: GLOBAL_ASSISTANT_CODEX_PROFILE },
    layers: [
      {
        name: { type: "user" as const, file: expected.profileFile, profile: expected.profileName },
        config: {
          permissions: {
            [GLOBAL_ASSISTANT_CODEX_PROFILE]: {
              filesystem: { ":root": "deny" },
              network: { enabled: false },
            },
          },
        },
      },
    ],
  },
  expected,
};

describe("Codex control-only profile", () => {
  it("requires the profile-capable Codex baseline", () => {
    expect(isSupportedGlobalAssistantCodexVersion("codex-cli 0.145.9")).toBe(false);
    expect(isSupportedGlobalAssistantCodexVersion("codex-cli 0.146.0")).toBe(true);
    expect(isSupportedGlobalAssistantCodexVersion("codex-cli 1.0.0")).toBe(true);
  });

  it("accepts exact isolated profile provenance", () => {
    expect(verifyCodexControlOnlyConfig(validInput)).toBeNull();
  });

  it("refuses legacy sandbox precedence and missing root denial", () => {
    expect(
      verifyCodexControlOnlyConfig({
        ...validInput,
        config: { ...validInput.config, config: { sandbox_mode: "read-only" } },
      }),
    ).toContain("legacy sandbox_mode");
    expect(
      verifyCodexControlOnlyConfig({
        ...validInput,
        config: {
          ...validInput.config,
          layers: [
            {
              ...validInput.config.layers[0]!,
              config: {
                permissions: {
                  [GLOBAL_ASSISTANT_CODEX_PROFILE]: {
                    filesystem: {},
                    network: { enabled: false },
                  },
                },
              },
            },
          ],
        },
      }),
    ).toContain(":root deny");
  });
});
