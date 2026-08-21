export type DesktopNightlyInstallArch = "arm64" | "x64";

export type DesktopNightlySigningPlan =
  | { readonly _tag: "Preserve" }
  | { readonly _tag: "Sign"; readonly identity: string };

export class UnsupportedDesktopNightlyInstallHostError extends Error {
  constructor(platform: string, arch: string) {
    super(`Nightly desktop installation is unsupported on ${platform}/${arch}.`);
    this.name = "UnsupportedDesktopNightlyInstallHostError";
  }
}

export class DesktopNightlyArtifactResolutionError extends Error {
  constructor(arch: DesktopNightlyInstallArch, count: number) {
    super(`Expected one T4 Code nightly ${arch} zip artifact, found ${count}.`);
    this.name = "DesktopNightlyArtifactResolutionError";
  }
}

export class InvalidDesktopNightlySigningIdentityError extends Error {
  constructor() {
    super("Desktop nightly signing identity must not be blank.");
    this.name = "InvalidDesktopNightlySigningIdentityError";
  }
}

export function resolveDesktopNightlyInstallArch(
  platform: string,
  arch: string,
): DesktopNightlyInstallArch {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return arch;
  }
  throw new UnsupportedDesktopNightlyInstallHostError(platform, arch);
}

export function resolveDesktopNightlyZipArtifact(
  fileNames: ReadonlyArray<string>,
  arch: DesktopNightlyInstallArch,
): string {
  const matches = fileNames.filter(
    (fileName) =>
      fileName.startsWith("T4-Code-") &&
      fileName.includes("-nightly.") &&
      fileName.endsWith(`-${arch}.zip`),
  );
  if (matches.length !== 1) {
    throw new DesktopNightlyArtifactResolutionError(arch, matches.length);
  }
  return matches[0]!;
}

export function isExpectedDesktopNightlyBundle(input: {
  bundleId: string;
  version: string;
}): boolean {
  return input.bundleId === "com.t3tools.t3code" && input.version.includes("-nightly.");
}

export function resolveDesktopNightlySigningPlan(input: {
  readonly hasValidNonAdHocSignature: boolean;
  readonly configuredIdentity: string | undefined;
}): DesktopNightlySigningPlan {
  if (input.hasValidNonAdHocSignature) {
    return { _tag: "Preserve" };
  }

  if (input.configuredIdentity === undefined) {
    return { _tag: "Sign", identity: "-" };
  }

  const identity = input.configuredIdentity.trim();
  if (identity.length === 0) {
    throw new InvalidDesktopNightlySigningIdentityError();
  }
  return { _tag: "Sign", identity };
}
