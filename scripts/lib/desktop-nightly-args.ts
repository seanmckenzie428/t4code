export class NightlyBuildVersionOverrideError extends Error {
  constructor() {
    super("Local nightly builds generate --build-version automatically; remove the override.");
    this.name = "NightlyBuildVersionOverrideError";
  }
}

export function resolveDesktopNightlyForwardedArgs(
  commandLineArgs: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const forwardedArgs =
    commandLineArgs[0] === "--" ? commandLineArgs.slice(1) : [...commandLineArgs];
  if (
    forwardedArgs.some(
      (argument) => argument === "--build-version" || argument.startsWith("--build-version="),
    )
  ) {
    throw new NightlyBuildVersionOverrideError();
  }
  return forwardedArgs;
}
