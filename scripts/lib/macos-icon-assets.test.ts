import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import sharp from "sharp";

const macIcons = [
  "dev/blueprint-macos-1024.png",
  "nightly/nightly-macos-1024.png",
  "prod/black-macos-1024.png",
];

describe("macOS Dock icon assets", () => {
  for (const icon of macIcons) {
    it(`${icon} preserves the native macOS safe area`, async () => {
      const { data, info } = await sharp(
        NodeURL.fileURLToPath(new URL(`../../assets/${icon}`, import.meta.url)),
      )
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      assert.equal(info.width, 1024);
      assert.equal(info.height, 1024);
      let left = info.width;
      let top = info.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels + 3] !== 255) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      assert.deepEqual(
        { left, top, right, bottom },
        { left: 100, top: 100, right: 923, bottom: 923 },
        "Dock artwork must be inset; full-bleed PNGs render oversized even on modern macOS.",
      );
    });
  }
});
