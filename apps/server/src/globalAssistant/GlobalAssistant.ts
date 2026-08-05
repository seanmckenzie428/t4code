import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION,
  isSupportedGlobalAssistantCodexVersion,
  isSupportedGlobalAssistantPlatform,
} from "./CodexControlOnlyProfile.ts";

export const GLOBAL_ASSISTANT_PROFILE_UNAVAILABLE_REASON =
  "T3 Assistant is unavailable because this build cannot enforce the required named Codex filesystem and network permission profile. Update Codex/T3 to a build with control-only profile enforcement.";

export type GlobalAssistantFoundationResult =
  | { readonly status: "disabled" }
  | { readonly status: "unavailable"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly workspaceRoot: string;
    };

export function makeGlobalAssistantIds(environmentId: EnvironmentId) {
  return {
    projectId: ProjectId.make(`t3-global-assistant-project-${environmentId}`),
    threadId: ThreadId.make(`t3-global-assistant-thread-${environmentId}`),
  } as const;
}

export function resolveGlobalAssistantAvailability(input: {
  readonly enabled: boolean;
  readonly selection: ModelSelection | null;
  readonly instance:
    | {
        readonly driverKind: ProviderDriverKind;
        readonly enabled: boolean;
      }
    | undefined;
  readonly profileEnforcementAvailable: boolean;
}):
  | { readonly status: "disabled" | "available" }
  | { readonly status: "unavailable"; readonly reason: string } {
  if (!input.enabled) {
    return { status: "disabled" };
  }
  if (input.selection === null) {
    return {
      status: "unavailable",
      reason: "T3 Assistant is enabled but no Codex instance and model are selected.",
    };
  }
  if (input.instance === undefined) {
    return {
      status: "unavailable",
      reason: `T3 Assistant Codex instance '${input.selection.instanceId}' is unavailable.`,
    };
  }
  if (input.instance.driverKind !== "codex") {
    return {
      status: "unavailable",
      reason: `T3 Assistant requires Codex; instance '${input.selection.instanceId}' uses '${input.instance.driverKind}'.`,
    };
  }
  if (!input.instance.enabled) {
    return {
      status: "unavailable",
      reason: `T3 Assistant Codex instance '${input.selection.instanceId}' is disabled.`,
    };
  }
  return input.profileEnforcementAvailable
    ? { status: "available" }
    : { status: "unavailable", reason: GLOBAL_ASSISTANT_PROFILE_UNAVAILABLE_REASON };
}

export const ensureGlobalAssistantFoundation = Effect.fn("ensureGlobalAssistantFoundation")(
  function* (options: { readonly profileEnforcementAvailable: boolean }) {
    const settingsService = yield* ServerSettings.ServerSettingsService;
    yield* settingsService.ready;
    const settings = yield* settingsService.getSettings;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const selection = settings.globalAssistant.modelSelection;
    const instance =
      selection === null ? undefined : yield* registry.getInstance(selection.instanceId);
    const availability = resolveGlobalAssistantAvailability({
      enabled: settings.globalAssistant.enabled,
      selection,
      instance,
      profileEnforcementAvailable: options.profileEnforcementAvailable,
    });
    if (availability.status === "disabled") {
      return availability;
    }
    if (availability.status === "unavailable") {
      return availability;
    }
    if (selection === null || instance === undefined) {
      return {
        status: "unavailable",
        reason: "T3 Assistant is enabled but no Codex instance and model are selected.",
      };
    }

    if (!isSupportedGlobalAssistantPlatform()) {
      return {
        status: "unavailable",
        reason: `T3 Assistant cannot enforce Codex permission profiles on '${process.platform}'.`,
      };
    }
    const providerSnapshot = yield* instance.snapshot.refresh;
    if (!isSupportedGlobalAssistantCodexVersion(providerSnapshot.version)) {
      return {
        status: "unavailable",
        reason: `T3 Assistant requires Codex ${MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION} or newer; selected instance reports '${providerSnapshot.version ?? "unknown"}'.`,
      };
    }

    const serverConfig = yield* ServerConfig.ServerConfig;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngine.OrchestrationEngineService;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const ids = makeGlobalAssistantIds(environmentId);
    const workspaceRoot = path.join(serverConfig.stateDir, "assistant");

    yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

    const existingProject = yield* projection.getProjectShellById(ids.projectId);
    if (Option.isNone(existingProject)) {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make(yield* crypto.randomUUIDv4),
        projectId: ids.projectId,
        kind: "system",
        systemRole: "global-assistant",
        title: "T3 Assistant",
        workspaceRoot,
        defaultModelSelection: selection,
        createdAt,
      });
    } else if (
      existingProject.value.kind !== "system" ||
      existingProject.value.systemRole !== "global-assistant"
    ) {
      return {
        status: "unavailable",
        reason: `Reserved T3 Assistant project id '${ids.projectId}' is occupied by a non-system project.`,
      };
    }

    const existingThread = yield* projection.getThreadShellById(ids.threadId);
    if (Option.isNone(existingThread)) {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(yield* crypto.randomUUIDv4),
        threadId: ids.threadId,
        projectId: ids.projectId,
        kind: "assistant",
        title: "T3 Assistant",
        modelSelection: selection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
    } else if (existingThread.value.kind !== "assistant") {
      return {
        status: "unavailable",
        reason: `Reserved T3 Assistant thread id '${ids.threadId}' is occupied by a project thread.`,
      };
    }

    return { status: "ready", ...ids, workspaceRoot };
  },
);

export const ensureConfiguredGlobalAssistant = ensureGlobalAssistantFoundation({
  profileEnforcementAvailable: true,
});
