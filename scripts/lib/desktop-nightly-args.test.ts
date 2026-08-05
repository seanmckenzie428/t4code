import { describe, expect, it } from "vite-plus/test";

import {
  NightlyBuildVersionOverrideError,
  resolveDesktopNightlyForwardedArgs,
} from "./desktop-nightly-args.ts";

describe("desktop-nightly-args", () => {
  it("strips one conventional argument separator", () => {
    expect(resolveDesktopNightlyForwardedArgs(["--", "--arch", "arm64"])).toEqual([
      "--arch",
      "arm64",
    ]);
    expect(resolveDesktopNightlyForwardedArgs(["--", "--", "--arch", "arm64"])).toEqual([
      "--",
      "--arch",
      "arm64",
    ]);
  });

  it("preserves arguments when no separator is present", () => {
    expect(resolveDesktopNightlyForwardedArgs(["--arch", "arm64"])).toEqual(["--arch", "arm64"]);
  });

  it.each([
    ["--build-version", "9.9.9"],
    ["--build-version=9.9.9"],
    ["--", "--build-version", "9.9.9"],
  ])("rejects generated version overrides: %j", (...args) => {
    expect(() => resolveDesktopNightlyForwardedArgs(args)).toThrow(
      NightlyBuildVersionOverrideError,
    );
  });
});
