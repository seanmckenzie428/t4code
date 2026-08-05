import {
  CommandId,
  EnvironmentId,
  ProjectId,
  type ModelSelection,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import {
  MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION,
  isSupportedGlobalAssistantCodexVersion,
  isSupportedGlobalAssistantPlatform,
} from "../globalAssistant/CodexControlOnlyProfile.ts";

export type QuickChatFoundationResult =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "ready"; readonly projectId: ProjectId; readonly workspaceRoot: string };

export function makeQuickChatProjectId(environmentId: EnvironmentId) {
  return ProjectId.make(`t3-quick-chat-project-${environmentId}`);
}

export function resolveQuickChatAvailability(input: {
  readonly selection: ModelSelection | null;
  readonly instance:
    | { readonly driverKind: ProviderDriverKind; readonly enabled: boolean }
    | undefined;
  readonly profileEnforcementAvailable: boolean;
}) {
  if (input.selection === null) {
    return {
      status: "unavailable",
      reason: "Quick Chat needs a Codex model selected in Settings.",
    } as const;
  }
  if (input.instance === undefined) {
    return {
      status: "unavailable",
      reason: `Quick Chat Codex instance '${input.selection.instanceId}' is unavailable.`,
    } as const;
  }
  if (input.instance.driverKind !== "codex") {
    return {
      status: "unavailable",
      reason: `Quick Chat requires Codex; instance '${input.selection.instanceId}' uses '${input.instance.driverKind}'.`,
    } as const;
  }
  if (!input.instance.enabled) {
    return {
      status: "unavailable",
      reason: `Quick Chat Codex instance '${input.selection.instanceId}' is disabled.`,
    } as const;
  }
  return input.profileEnforcementAvailable
    ? ({ status: "available" } as const)
    : ({
        status: "unavailable",
        reason: "Quick Chat cannot enforce the required control-only Codex profile in this build.",
      } as const);
}

export const ensureQuickChatFoundation = Effect.fn("ensureQuickChatFoundation")(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  yield* settingsService.ready;
  const settings = yield* settingsService.getSettings;
  const selection = settings.globalAssistant.modelSelection;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const instance =
    selection === null ? undefined : yield* registry.getInstance(selection.instanceId);
  const availability = resolveQuickChatAvailability({
    selection,
    instance,
    profileEnforcementAvailable: true,
  });
  if (availability.status === "unavailable") return availability;
  if (selection === null || instance === undefined) return availability;

  const platform = yield* HostProcessPlatform;
  if (!isSupportedGlobalAssistantPlatform(platform)) {
    return {
      status: "unavailable",
      reason: `Quick Chat cannot enforce Codex permission profiles on '${platform}'.`,
    } as const;
  }
  const providerSnapshot = yield* instance.snapshot.refresh;
  if (!isSupportedGlobalAssistantCodexVersion(providerSnapshot.version)) {
    return {
      status: "unavailable",
      reason: `Quick Chat requires Codex ${MINIMUM_GLOBAL_ASSISTANT_CODEX_VERSION} or newer; selected instance reports '${providerSnapshot.version ?? "unknown"}'.`,
    } as const;
  }

  const serverConfig = yield* ServerConfig.ServerConfig;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environmentId = yield* serverEnvironment.getEnvironmentId;
  const projectId = makeQuickChatProjectId(environmentId);
  const workspaceRoot = path.join(serverConfig.stateDir, "quick-chat");

  yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

  const existingProject = yield* projection.getProjectShellById(projectId);
  if (Option.isNone(existingProject)) {
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId,
      kind: "system",
      systemRole: "quick-chat",
      title: "Quick Chat",
      workspaceRoot,
      defaultModelSelection: selection,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  } else if (
    existingProject.value.kind !== "system" ||
    existingProject.value.systemRole !== "quick-chat"
  ) {
    return {
      status: "unavailable",
      reason: `Reserved Quick Chat project id '${projectId}' is occupied by another project.`,
    } as const;
  }

  return { status: "ready", projectId, workspaceRoot } as const;
});

export const watchConfiguredQuickChat = Effect.fn("watchConfiguredQuickChat")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const settingsChanges = yield* settings.subscribeChanges;
  const instanceChanges = yield* registry.subscribeChanges;
  const changes = Stream.merge(
    settingsChanges.pipe(Stream.map(() => undefined)),
    Stream.fromSubscription(instanceChanges),
  );
  const attempt = ensureQuickChatFoundation().pipe(
    Effect.tap((result) =>
      result.status === "unavailable"
        ? Effect.logDebug("Quick Chat provisioning unavailable", { reason: result.reason })
        : Effect.void,
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Quick Chat foundation check failed", { cause }),
    ),
  );

  yield* attempt;
  yield* Stream.runForEach(changes, () => attempt).pipe(Effect.forkScoped);
});
