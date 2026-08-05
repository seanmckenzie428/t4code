import { describe, expect, it } from "vite-plus/test";

import {
  DesktopNightlyArtifactResolutionError,
  isExpectedDesktopNightlyBundle,
  resolveDesktopNightlyInstallArch,
  resolveDesktopNightlyZipArtifact,
  UnsupportedDesktopNightlyInstallHostError,
} from "./desktop-nightly-install.ts";

describe("desktop-nightly-install", () => {
  it("uses the current supported Mac architecture", () => {
    expect(resolveDesktopNightlyInstallArch("darwin", "arm64")).toBe("arm64");
    expect(resolveDesktopNightlyInstallArch("darwin", "x64")).toBe("x64");
  });

  it("rejects unsupported hosts", () => {
    expect(() => resolveDesktopNightlyInstallArch("linux", "x64")).toThrow(
      UnsupportedDesktopNightlyInstallHostError,
    );
    expect(() => resolveDesktopNightlyInstallArch("darwin", "universal")).toThrow(
      UnsupportedDesktopNightlyInstallHostError,
    );
  });

  it("selects the one nightly zip for the host architecture", () => {
    expect(
      resolveDesktopNightlyZipArtifact(
        [
          "T4-Code-0.0.32-nightly.20260805.71636-arm64.dmg",
          "T4-Code-0.0.32-nightly.20260805.71636-arm64.zip",
          "T4-Code-0.0.32-nightly.20260805.71636-arm64.zip.blockmap",
        ],
        "arm64",
      ),
    ).toBe("T4-Code-0.0.32-nightly.20260805.71636-arm64.zip");
  });

  it("rejects missing or ambiguous artifacts", () => {
    expect(() => resolveDesktopNightlyZipArtifact([], "arm64")).toThrow(
      DesktopNightlyArtifactResolutionError,
    );
    expect(() =>
      resolveDesktopNightlyZipArtifact(
        [
          "T4-Code-0.0.32-nightly.20260805.1-arm64.zip",
          "T4-Code-0.0.32-nightly.20260805.2-arm64.zip",
        ],
        "arm64",
      ),
    ).toThrow(DesktopNightlyArtifactResolutionError);
  });

  it("accepts only the T4 nightly bundle identity", () => {
    expect(
      isExpectedDesktopNightlyBundle({
        bundleId: "com.t3tools.t3code",
        version: "0.0.32-nightly.20260805.71636",
      }),
    ).toBe(true);
    expect(
      isExpectedDesktopNightlyBundle({
        bundleId: "com.t3tools.t3code",
        version: "0.0.32",
      }),
    ).toBe(false);
    expect(
      isExpectedDesktopNightlyBundle({
        bundleId: "com.example.other",
        version: "0.0.32-nightly.20260805.71636",
      }),
    ).toBe(false);
  });
});
