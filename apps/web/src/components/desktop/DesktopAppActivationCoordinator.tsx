import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useRouter } from "@tanstack/react-router";
import type { DesktopAppActivationRequest } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { handleDesktopAppActivationRequest } from "../../desktopAppActivation";
import { startDesktopThread } from "../../desktopThreadStart";
import { useComposerDraftStore } from "../../composerDraftStore";
import { resolveDefaultProviderModelSelection } from "../../providerInstances";
import { getComposerProviderState } from "../chat/composerProviderState";
import { resolveNewThreadModelSelectionOverride } from "../../lib/chatThreadActions";
import { resolveComposerInteractionMode } from "../ChatView.logic";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../../lib/projectPaths";
import { newProjectId } from "../../lib/utils";
import {
  readProject,
  readProjects,
  readThreadShell,
  waitForProject,
  waitForThreadShell,
} from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentShell } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { threadEnvironment } from "../../state/threads";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";

export function DesktopAppActivationCoordinator() {
  const primaryEnvironment = usePrimaryEnvironment();
  const router = useRouter();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const activation = window.desktopBridge?.appActivation;
  const shell = useEnvironmentQuery(
    primaryEnvironment === null
      ? null
      : environmentShell.stateAtom(primaryEnvironment.environmentId),
  );
  const ready =
    activation !== undefined &&
    primaryEnvironment?.connection.phase === "connected" &&
    primaryEnvironment.serverConfig !== null &&
    shell.data?.snapshot._tag === "Some";

  const processRequest = useEffectEvent(async (request: DesktopAppActivationRequest) =>
    handleDesktopAppActivationRequest(request, {
      getTarget: () => {
        if (
          primaryEnvironment?.connection.phase !== "connected" ||
          primaryEnvironment.serverConfig === null
        ) {
          return null;
        }
        return {
          environmentId: primaryEnvironment.environmentId,
          platform: primaryEnvironment.serverConfig.environment.platform.os,
        };
      },
      findProject: (environmentId, workspaceRoot) =>
        findProjectByPath(
          readProjects().filter((project) => project.environmentId === environmentId),
          workspaceRoot,
        ) ?? null,
      createProject: async (environmentId, workspaceRoot) => {
        const projectId = newProjectId();
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(workspaceRoot),
            workspaceRoot,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          throw error instanceof Error ? error : new Error("Pilot could not add the project.");
        }
        return projectId;
      },
      waitForProject: async (projectRef) => {
        await waitForProject(projectRef);
      },
      openThread: (projectRef) => openThread(projectRef),
      startThread: async (projectRef, request) => {
        const project = readProject(projectRef);
        const config = primaryEnvironment?.serverConfig;
        if (!project || !config) throw new Error("The Lotus project is unavailable.");
        const defaults = resolveProjectSettings(config.settings, project.id, project).settings;
        const sticky = useComposerDraftStore.getState();
        const route = resolveThreadRouteTarget(
          router.state.matches[router.state.matches.length - 1]?.params ?? {},
        );
        const composer = route
          ? sticky.getComposerDraft(route.kind === "server" ? route.threadRef : route.draftId)
          : null;
        const carry =
          (composer?.activeProvider
            ? composer.modelSelectionByProvider[composer.activeProvider]
            : null) ??
          (route?.kind === "server" ? readThreadShell(route.threadRef)?.modelSelection : null);
        const preferred =
          resolveNewThreadModelSelectionOverride({
            projectDefaultSelection: defaults.defaultModelSelection ?? null,
            carrySelection: carry ?? null,
            carrySourceDraftId: route?.kind === "draft" ? route.draftId : null,
            destinationDraftId: request.requestId,
          }) ??
          (sticky.stickyActiveProvider
            ? sticky.stickyModelSelectionByProvider[sticky.stickyActiveProvider]
            : undefined);
        const modelSelection = resolveDefaultProviderModelSelection(config.providers, preferred);
        if (!modelSelection)
          throw new Error("Configure an available default provider/model for Lotus first.");
        const provider = config.providers.find(
          (entry) => entry.instanceId === modelSelection.instanceId,
        );
        const planModeEnabled = Boolean(request.prompt);
        // An explicit external Plan request does not depend on the beta UI toggle.
        if (
          planModeEnabled &&
          !resolveComposerInteractionMode({
            planModeEnabled,
            provider,
            interactionMode: "plan",
          }).enabled
        ) {
          throw new Error("Select a default provider supporting Plan mode in Lotus settings.");
        }
        if (!provider) throw new Error("The selected provider is unavailable.");
        const options = getComposerProviderState({
          provider: provider.driver,
          model: modelSelection.model,
          models: provider.models,
          modelOptions: modelSelection.options,
          planModeEnabled,
        }).modelOptionsForDispatch;
        const dispatchSelection = createModelSelection(
          modelSelection.instanceId,
          modelSelection.model,
          options,
        );
        return startDesktopThread(
          projectRef,
          request,
          { modelSelection: dispatchSelection, runtimeMode: defaults.defaultRuntimeMode },
          {
            waitForThread: async (threadRef) => {
              await waitForThreadShell(threadRef);
            },
            navigate: async (threadRef) => {
              await router.navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(threadRef),
              });
            },
            create: async (input) => {
              const result = await createThread({ environmentId: projectRef.environmentId, input });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            },
            start: async (input) => {
              const result = await startTurn({ environmentId: projectRef.environmentId, input });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            },
          },
        );
      },
    }),
  );

  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      queueRef.current = queueRef.current.then(async () => {
        const response = await processRequest(request);
        await activation.complete(response);
      });
      queueRef.current = queueRef.current.catch(() => undefined);
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) void activation.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready]);

  return null;
}
