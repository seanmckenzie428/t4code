import { assert, it } from "@effect/vitest";
import { remapLegacyClaudeForkTurnBoundaries } from "./ClaudeForkTurnBoundaries.ts";

const input = {
  hasReverted: true,
  providerInstanceId: "claude-personal",
  turns: ["original-1", "original-2"].map((turnId) => ({
    turnId,
    pendingMessageId: `message:${turnId}`,
    driver: "claudeAgent",
    providerInstanceId: "claude-personal",
  })),
  nativeBoundaries: ["fork-1", "fork-2"],
};

it("maps retained app turns to the native UUIDs saved by a V1 fork", () => {
  assert.deepEqual(
    [...remapLegacyClaudeForkTurnBoundaries(input)!],
    [
      ["original-1", "fork-1"],
      ["original-2", "fork-2"],
    ],
  );
});
it("accepts an unchanged UUID after the rewritten prefix", () => {
  assert.deepEqual(
    [
      ...remapLegacyClaudeForkTurnBoundaries({
        ...input,
        nativeBoundaries: ["fork-1", "original-2"],
      })!,
    ],
    [
      ["original-1", "fork-1"],
      ["original-2", "original-2"],
    ],
  );
});
for (const [name, changed] of [
  ["missing persisted rewind", { ...input, hasReverted: false }],
  ["unequal native and app turn counts", { ...input, nativeBoundaries: ["fork-1"] }],
  [
    "foreign provider history",
    { ...input, turns: [{ ...input.turns[0]!, driver: "codex" }, input.turns[1]!] },
  ],
  [
    "foreign provider instance",
    { ...input, turns: [{ ...input.turns[0]!, providerInstanceId: "other" }, input.turns[1]!] },
  ],
  [
    "missing provider evidence",
    { ...input, turns: [{ ...input.turns[0]!, driver: null }, input.turns[1]!] },
  ],
  [
    "missing instance evidence",
    { ...input, turns: [{ ...input.turns[0]!, providerInstanceId: null }, input.turns[1]!] },
  ],
  ["missing native boundary", { ...input, nativeBoundaries: ["fork-1", null] }],
  ["duplicate native boundary", { ...input, nativeBoundaries: ["fork-1", "fork-1"] }],
  ["contradictory exact UUID anchor", { ...input, nativeBoundaries: ["original-2", "fork-1"] }],
  [
    "synthetic assistant turn",
    { ...input, turns: [{ ...input.turns[0]!, pendingMessageId: null }, input.turns[1]!] },
  ],
] as const) {
  it(`rejects ambiguous remapping with ${name}`, () => {
    assert.isUndefined(remapLegacyClaudeForkTurnBoundaries(changed));
  });
}
