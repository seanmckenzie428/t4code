import * as NodeAssert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexDeveloperInstructions", () => {
  it("keeps Pilot context out of the mode prompt, which the model catalog can replace", () => {
    for (const mode of ["default", "plan"] as const) {
      const instructions = buildCodexDeveloperInstructions(mode);
      NodeAssert.match(instructions, /^<collaboration_mode>[\s\S]*<\/collaboration_mode>$/);
      NodeAssert.doesNotMatch(instructions, /runtime_info|pull_request_linking|preview_|device_/);
    }
  });
});

describe("buildCodexAdditionalContext", () => {
  const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };
  const runtimeValue = (context: ReturnType<typeof buildCodexAdditionalContext>) =>
    context.t3_code_runtime?.value ?? "";

  it("describes the harness, model, effort, and Markdown media support", () => {
    const context = buildCodexAdditionalContext(runtime);

    NodeAssert.equal(context.t3_code_runtime?.kind, "application");
    NodeAssert.match(runtimeValue(context), /Pilot/);
    NodeAssert.match(
      runtimeValue(context),
      /<runtime_info>.*Codex harness, as gpt-5\.3-codex with high reasoning effort.*embed images and videos.*Markdown.*<\/runtime_info>/,
    );
  });

  it("varies with the model and effort of each turn", () => {
    NodeAssert.notEqual(
      runtimeValue(
        buildCodexAdditionalContext({ model: "gpt-5.3-codex", reasoningEffort: "medium" }),
      ),
      runtimeValue(buildCodexAdditionalContext({ model: "gpt-5.4", reasoningEffort: "high" })),
    );
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const value = runtimeValue(
      buildCodexAdditionalContext({ model: "gpt\n5.3\ncodex", reasoningEffort: " high\neffort " }),
    );

    NodeAssert.match(value, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(value, /<runtime_info>[^<]*\n/);
  });

  it("keeps every entry under Codex's 1,000 token cap per entry", () => {
    const context = buildCodexAdditionalContext(runtime, { browser: true, device: true });
    for (const entry of Object.values(context)) {
      // Codex estimates 4 bytes per token and truncates the middle of longer values.
      NodeAssert.ok(Buffer.byteLength(entry.value) < 4_000);
    }
  });
});

describe("T3 tool instructions", () => {
  const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };

  it("prefers the product-native preview tools when they are attached", () => {
    const tools = buildCodexAdditionalContext(runtime, true).t3_code_tools?.value ?? "";
    NodeAssert.match(tools, /t3-code/);
    NodeAssert.match(tools, /preview_status/);
    NodeAssert.match(tools, /preview_open/);
    NodeAssert.match(tools, /Do not switch to global browser skills/);
    NodeAssert.doesNotMatch(tools, /device_open/);
  });

  it("describes device tools only when the credential grants them", () => {
    const tools =
      buildCodexAdditionalContext(runtime, { browser: false, device: true }).t3_code_tools?.value ??
      "";
    NodeAssert.match(tools, /device_open/);
    NodeAssert.doesNotMatch(tools, /preview_open/);
  });

  it("retains app control but omits browser and device guidance when those tools are absent", () => {
    // Steering away from other browser automation must go with the tools;
    // keeping it would leave the model talked out of its only option.
    const context = buildCodexAdditionalContext(runtime, false);
    NodeAssert.deepStrictEqual(
      Object.keys(context).filter((key) => !key.startsWith("t3_code_orchestration")),
      ["t3_code_runtime", "t3_code_app_views", "t3_code_app_control"],
    );
    const instructions = Object.values(context)
      .map((entry) => entry.value)
      .join("\n");
    NodeAssert.match(instructions, /Generated app views/);
    NodeAssert.match(instructions, /app_status/);
    NodeAssert.doesNotMatch(
      instructions,
      /preview_open|device_open|Do not switch to global browser skills/,
    );
  });
});

describe("Pilot generated-view additional context", () => {
  it("teaches generated views independently of the replaceable collaboration mode", () => {
    for (const availability of [true, false]) {
      const instructions =
        buildCodexAdditionalContext({ model: "gpt-5.6", reasoningEffort: "high" }, availability)
          .t3_code_app_views?.value ?? "";
      NodeAssert.match(instructions, /add this to Pilot/);
      NodeAssert.match(instructions, /app_status/);
      NodeAssert.match(instructions, /app_view_present/);
      NodeAssert.match(instructions, /app_view_update/);
      NodeAssert.match(instructions, /action: \{ primary:/);
      NodeAssert.match(instructions, /separate chevron opens options/);
      NodeAssert.match(instructions, /Do not edit the Pilot source tree/);
    }
  });
});
