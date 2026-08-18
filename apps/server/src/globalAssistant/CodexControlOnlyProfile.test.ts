import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  GLOBAL_ASSISTANT_CODEX_PROFILE,
  isSupportedGlobalAssistantCodexVersion,
  materializeCodexControlOnlyProfile,
  verifyCodexControlOnlyConfig,
} from "./CodexControlOnlyProfile.ts";

const expected = {
  codexHome: "/state/assistant/codex-home",
  configFile: "/state/assistant/codex-home/config.toml",
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
        name: { type: "user" as const, file: expected.configFile, profile: null },
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
  it.effect("writes the control policy directly to the isolated base config", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-control-only-" });
      const result = yield* materializeCodexControlOnlyProfile({
        assistantRoot: path.join(root, "assistant"),
        authHomePath: path.join(root, "auth-home"),
      });

      expect(result.configFile).toBe(path.join(root, "assistant", "codex-home", "config.toml"));
      expect(yield* fileSystem.readFileString(result.configFile)).toContain(
        `default_permissions = "${GLOBAL_ASSISTANT_CODEX_PROFILE}"`,
      );
      expect(
        yield* fileSystem.exists(path.join(result.codexHome, "t3-control-only.config.toml")),
      ).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

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
