import { describe, expect, it } from "vite-plus/test";

import {
  DesktopNightlyArtifactResolutionError,
  InvalidDesktopNightlySigningIdentityError,
  isExpectedDesktopNightlyBundle,
  resolveDesktopNightlyInstallArch,
  resolveDesktopNightlySigningPlan,
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
          "Pilot-0.0.32-nightly.20260805.71636-arm64.dmg",
          "Pilot-0.0.32-nightly.20260805.71636-arm64.zip",
          "Pilot-0.0.32-nightly.20260805.71636-arm64.zip.blockmap",
        ],
        "arm64",
      ),
    ).toBe("Pilot-0.0.32-nightly.20260805.71636-arm64.zip");
  });

  it("rejects missing or ambiguous artifacts", () => {
    expect(() => resolveDesktopNightlyZipArtifact([], "arm64")).toThrow(
      DesktopNightlyArtifactResolutionError,
    );
    expect(() =>
      resolveDesktopNightlyZipArtifact(
        ["Pilot-0.0.32-nightly.20260805.1-arm64.zip", "Pilot-0.0.32-nightly.20260805.2-arm64.zip"],
        "arm64",
      ),
    ).toThrow(DesktopNightlyArtifactResolutionError);
  });

  it("accepts only the Pilot nightly bundle identity", () => {
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

  it("preserves a valid certificate-backed artifact signature", () => {
    expect(
      resolveDesktopNightlySigningPlan({
        hasValidNonAdHocSignature: true,
        configuredIdentity: "LOCAL_CERT",
      }),
    ).toEqual({ _tag: "Preserve" });
  });

  it("uses an explicitly configured identity for unsigned artifacts", () => {
    expect(
      resolveDesktopNightlySigningPlan({
        hasValidNonAdHocSignature: false,
        configuredIdentity: "  LOCAL_CERT  ",
      }),
    ).toEqual({ _tag: "Sign", identity: "LOCAL_CERT" });
  });

  it("falls back to ad-hoc signing when no identity is configured", () => {
    expect(
      resolveDesktopNightlySigningPlan({
        hasValidNonAdHocSignature: false,
        configuredIdentity: undefined,
      }),
    ).toEqual({ _tag: "Sign", identity: "-" });
  });

  it("rejects a blank configured signing identity", () => {
    expect(() =>
      resolveDesktopNightlySigningPlan({
        hasValidNonAdHocSignature: false,
        configuredIdentity: "   ",
      }),
    ).toThrow(InvalidDesktopNightlySigningIdentityError);
  });
});
