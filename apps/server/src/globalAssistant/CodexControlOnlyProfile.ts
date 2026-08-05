import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export const GLOBAL_ASSISTANT_CODEX_PROFILE = "t3-control-only";
export const MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION = "0.146.0";

const PROFILE_FILE_NAME = `${GLOBAL_ASSISTANT_CODEX_PROFILE}.config.toml`;

const CONTROL_ONLY_PROFILE = `default_permissions = "${GLOBAL_ASSISTANT_CODEX_PROFILE}"
approval_policy = "never"
approvals_reviewer = "user"
web_search = "disabled"

[permissions.${GLOBAL_ASSISTANT_CODEX_PROFILE}.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.${GLOBAL_ASSISTANT_CODEX_PROFILE}.filesystem.":workspace_roots"]
"." = "deny"

[permissions.${GLOBAL_ASSISTANT_CODEX_PROFILE}.network]
enabled = false

[features]
apps = false
browser_use = false
computer_use = false
default_mode_request_user_input = false
goals = false
image_generation = false
memories = false
multi_agent = false
plugins = false
request_permissions_tool = false
shell_tool = false
tool_call_mcp_elicitation = false
unified_exec = false
`;

export interface CodexControlOnlyProfile {
  readonly codexHome: string;
  readonly profileFile: string;
  readonly profileName: typeof GLOBAL_ASSISTANT_CODEX_PROFILE;
}

function parseVersion(value: string): readonly [number, number, number] | null {
  const match = value.match(/(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSupportedGlobalAssistantCodexVersion(value: string | null | undefined): boolean {
  const actual = value ? parseVersion(value) : null;
  const minimum = parseVersion(MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION);
  if (!actual || !minimum) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index]! > minimum[index]!) return true;
    if (actual[index]! < minimum[index]!) return false;
  }
  return true;
}

export function isSupportedGlobalAssistantPlatform(platform: string = process.platform): boolean {
  return (
    platform === "darwin" ||
    platform === "macos" ||
    platform === "linux" ||
    platform === "win32" ||
    platform === "windows"
  );
}

export class CodexControlOnlyProfileError extends Schema.TaggedErrorClass<CodexControlOnlyProfileError>()(
  "CodexControlOnlyProfileError",
  { message: Schema.String },
) {}

function isNotFound(cause: PlatformError.PlatformError): boolean {
  return cause.reason._tag === "NotFound";
}

function isNotSymlink(cause: PlatformError.PlatformError): boolean {
  const reason = cause.reason;
  return (
    reason._tag === "Unknown" &&
    typeof reason.cause === "object" &&
    reason.cause !== null &&
    "code" in reason.cause &&
    reason.cause.code === "EINVAL"
  );
}

export const materializeCodexControlOnlyProfile = Effect.fn("materializeCodexControlOnlyProfile")(
  function* (input: { readonly assistantRoot: string; readonly authHomePath: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const codexHome = path.join(input.assistantRoot, "codex-home");
    const profileFile = path.join(codexHome, PROFILE_FILE_NAME);
    const configFile = path.join(codexHome, "config.toml");
    const sourceAuth = path.join(input.authHomePath, "auth.json");
    const assistantAuth = path.join(codexHome, "auth.json");

    yield* fileSystem.makeDirectory(codexHome, { recursive: true });
    // The isolated base intentionally contains no user MCP servers, apps,
    // hooks, skills, plugins, or project configuration.
    yield* fileSystem.writeFileString(configFile, "");
    yield* fileSystem.writeFileString(profileFile, CONTROL_ONLY_PROFILE);

    const sourceAuthExists = yield* fileSystem.exists(sourceAuth);
    if (sourceAuthExists) {
      const existingTarget = yield* fileSystem.readLink(assistantAuth).pipe(
        Effect.map((target) => path.resolve(path.dirname(assistantAuth), target)),
        Effect.catchTags({
          PlatformError: (cause) => {
            if (isNotFound(cause)) return Effect.succeed<string | null>(null);
            if (isNotSymlink(cause)) {
              return Effect.fail(
                new CodexControlOnlyProfileError({
                  message: `Refusing to replace non-symlink Codex auth at '${assistantAuth}'. Remove it and retry.`,
                }),
              );
            }
            return Effect.fail(cause);
          },
        }),
      );
      if (existingTarget !== sourceAuth) {
        if (existingTarget !== null) {
          yield* fileSystem.remove(assistantAuth);
        }
        yield* fileSystem.symlink(sourceAuth, assistantAuth);
      }
    }

    return {
      codexHome,
      profileFile,
      profileName: GLOBAL_ASSISTANT_CODEX_PROFILE,
    } satisfies CodexControlOnlyProfile;
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function verifyCodexControlOnlyConfig(input: {
  readonly initialize: {
    readonly codexHome: string;
    readonly platformOs: string;
    readonly userAgent: string;
  };
  readonly config: {
    readonly config: Record<string, unknown>;
    readonly layers?: ReadonlyArray<{
      readonly config: unknown;
      readonly name:
        | { readonly type: "user"; readonly file: string; readonly profile?: string | null }
        | { readonly type: string };
    }> | null;
  };
  readonly expected: CodexControlOnlyProfile;
}): string | null {
  if (input.initialize.codexHome !== input.expected.codexHome) {
    return `Codex loaded '${input.initialize.codexHome}' instead of isolated home '${input.expected.codexHome}'.`;
  }
  if (!isSupportedGlobalAssistantPlatform(input.initialize.platformOs)) {
    return `Codex permission profiles are unsupported on '${input.initialize.platformOs}'.`;
  }
  if (!isSupportedGlobalAssistantCodexVersion(input.initialize.userAgent)) {
    return `Codex ${MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION} or newer is required; received '${input.initialize.userAgent}'.`;
  }
  if (input.config.config.sandbox_mode !== undefined && input.config.config.sandbox_mode !== null) {
    return "Codex activated legacy sandbox_mode instead of the control-only permission profile.";
  }
  if (input.config.config.default_permissions !== GLOBAL_ASSISTANT_CODEX_PROFILE) {
    return `Codex did not activate permission profile '${GLOBAL_ASSISTANT_CODEX_PROFILE}'.`;
  }

  const profileLayer = input.config.layers?.find(
    (layer) =>
      layer.name.type === "user" &&
      "file" in layer.name &&
      layer.name.file === input.expected.profileFile &&
      layer.name.profile === input.expected.profileName,
  );
  if (!profileLayer || !isRecord(profileLayer.config)) {
    return `Codex did not report provenance for '${input.expected.profileFile}'.`;
  }
  const permissions = profileLayer.config.permissions;
  const namedPermissions = isRecord(permissions)
    ? permissions[GLOBAL_ASSISTANT_CODEX_PROFILE]
    : null;
  const filesystem = isRecord(namedPermissions) ? namedPermissions.filesystem : null;
  const network = isRecord(namedPermissions) ? namedPermissions.network : null;
  if (!isRecord(filesystem) || filesystem[":root"] !== "deny") {
    return "Codex control-only profile is missing the explicit :root deny rule.";
  }
  if (!isRecord(network) || network.enabled !== false) {
    return "Codex control-only profile did not disable network access.";
  }
  return null;
}
