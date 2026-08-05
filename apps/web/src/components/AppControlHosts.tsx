"use client";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { APP_COMMAND_CATALOG } from "@t3tools/client-runtime/app-control";
import {
  AppControlClientId,
  AppCommandId,
  type AppControlConnectionId,
  type AppControlRequest,
  type AppCommandInvocation,
  type EnvironmentId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { registerWebAppCommandHandler, webAppCommandRegistry } from "../appCommandRegistry";
import { randomHex } from "../lib/utils";
import { useUpdateClientSettings } from "../hooks/useSettings";
import { useQuickChatStore } from "../quickChatStore";
import { selectThreadAppViews, useAppViewStore } from "../appViewStore";
import { useEnvironments } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { appControlEnvironment } from "../state/appControl";
import { useAtomCommand } from "../state/use-atom-command";
import { createAppControlRequestConsumerAtom } from "./appControlRequestConsumer";

const RESERVED_COMMAND_IDS = ["app.status", "app.commands"] as const;
// Confirmation previews for server-owned commands use the same focused-client
// lease, so the host advertises every semantic ID even though it executes only
// client-owned registrations.
const HOST_COMMAND_IDS = APP_COMMAND_CATALOG.map(({ descriptor }) => descriptor.id);
const COMPLETED_ACTION_LIMIT = 256;

export const isAppControlHostFocused = (
  documentState: Pick<Document, "hasFocus" | "visibilityState">,
): boolean => documentState.visibilityState === "visible" && documentState.hasFocus();

export function AppControlHosts() {
  const { environments } = useEnvironments();
  return environments.map((environment) => (
    <AppControlHost key={environment.environmentId} environmentId={environment.environmentId} />
  ));
}

function AppControlHost({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [clientId] = useState(() => AppControlClientId.make(`web-${randomHex(16)}`));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const quickChatOpen = useQuickChatStore(
    (state) => state.byEnvironment[String(environmentId)]?.open ?? false,
  );
  const appViewsByThread = useAppViewStore((state) => state.byThreadKey);
  const respond = useAtomCommand(appControlEnvironment.respond, "app control response");
  const focusHost = useAtomCommand(appControlEnvironment.focusHost, "app control host focus");
  const updateClientSettings = useUpdateClientSettings();
  useEffect(() => {
    const availability = (context: { environmentId: string }) => ({
      available: context.environmentId === environmentId,
      reason: "The settings command is hosted by another environment.",
    });
    const execute = (invocation: AppCommandInvocation) => {
      const { changes } = invocation.args as {
        changes: Parameters<typeof updateClientSettings>[0];
      };
      updateClientSettings(changes);
    };
    const disposers = [
      registerWebAppCommandHandler("settings.appearance.update", execute, availability),
      registerWebAppCommandHandler("settings.ux.update", execute, availability),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [environmentId, updateClientSettings]);
  const host = useMemo(
    () => ({
      clientId,
      environmentId,
      supportedCommandIds: [...RESERVED_COMMAND_IDS, ...HOST_COMMAND_IDS].map((id) =>
        AppCommandId.make(id),
      ),
    }),
    [clientId, environmentId],
  );
  const requestsAtom = useMemo(
    () => appControlEnvironment.requests({ environmentId, input: host }),
    [environmentId, host],
  );
  const [connectionAtom] = useState(() => Atom.make<AppControlConnectionId | null>(null));
  const connectionId = useAtomValue(connectionAtom);
  const completedActions = useRef(new Map<string, unknown>());

  const handleRequest = useCallback(
    async (request: AppControlRequest): Promise<unknown> => {
      if (request.confirmation !== undefined) {
        const confirmation = request.confirmation;
        const descendants =
          confirmation.descendants === undefined
            ? ""
            : `\nAffected descendants: ${confirmation.descendants}`;
        const allowed = window.confirm(
          `${confirmation.title}\n\n${confirmation.description}\n\nTarget: ${confirmation.targetName}\nEnvironment: ${confirmation.environmentId}${descendants}\nRecoverability: ${confirmation.recoverability}`,
        );
        return { decision: allowed ? "allow" : "decline" };
      }
      const context = {
        environmentId,
        ...(request.principal.kind === "thread-agent"
          ? { projectId: String(request.principal.projectId) }
          : {}),
        threadId:
          request.principal.kind === "thread-agent"
            ? String(request.principal.threadId)
            : String(request.principal.assistantThreadId),
        source: "mcp" as const,
      };
      if (request.commandId === "app.commands") {
        return webAppCommandRegistry
          .list(context, { includeUnavailable: false })
          .map(({ descriptor }) => descriptor);
      }
      if (request.commandId === "app.status") {
        const ref = {
          environmentId,
          threadId:
            request.principal.kind === "thread-agent"
              ? request.principal.threadId
              : request.principal.assistantThreadId,
        };
        return {
          sequence: 0,
          environmentId,
          focusedClient: {
            clientId,
            surface: window.desktopBridge ? "desktop" : "web",
            projectId:
              request.principal.kind === "thread-agent" ? request.principal.projectId : null,
            threadId:
              request.principal.kind === "thread-agent"
                ? request.principal.threadId
                : request.principal.assistantThreadId,
            quickChatOpen,
            activePanel: null,
            revision: 0,
          },
          projects: projects.map((project) => ({
            id: project.id,
            title: project.title,
            kind: project.kind ?? "workspace",
          })),
          threads: threads.map((thread) => ({
            id: thread.id,
            projectId: thread.projectId,
            title: thread.title,
            kind: thread.kind ?? "project",
          })),
          views: Object.values(selectThreadAppViews(appViewsByThread, ref).manifests).map(
            ({ id, title, kind, revision, scope }) => ({ id, title, kind, revision, scope }),
          ),
          commands: webAppCommandRegistry
            .list(context, { includeUnavailable: false })
            .map(({ descriptor }) => descriptor),
        };
      }
      const replay = completedActions.current.get(request.actionId);
      if (completedActions.current.has(request.actionId)) {
        return {
          status: "completed",
          receipt: {
            receiptId: `client:${request.actionId}`,
            actionId: request.actionId,
            commandId: request.commandId,
            completedAt: new Date().toISOString(),
            idempotentReplay: true,
          },
          result: replay ?? null,
        };
      }
      const result = await webAppCommandRegistry.invoke(
        {
          actionId: request.actionId,
          commandId: request.commandId,
          args: request.args,
          ...(request.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.expectedRevision }),
        },
        context,
      );
      completedActions.current.set(request.actionId, result);
      if (completedActions.current.size > COMPLETED_ACTION_LIMIT) {
        const oldestActionId = completedActions.current.keys().next().value;
        if (oldestActionId !== undefined) completedActions.current.delete(oldestActionId);
      }
      return {
        status: "completed",
        receipt: {
          receiptId: `client:${request.actionId}`,
          actionId: request.actionId,
          commandId: request.commandId,
          completedAt: new Date().toISOString(),
          idempotentReplay: false,
        },
        result: result ?? null,
      };
    },
    [appViewsByThread, clientId, environmentId, projects, quickChatOpen, threads],
  );
  const [requestHandlerAtom] = useState(() => Atom.make({ handle: handleRequest }));
  const setRequestHandler = useAtomSet(requestHandlerAtom);
  useEffect(() => {
    setRequestHandler({ handle: handleRequest });
  }, [handleRequest, setRequestHandler]);
  const requestConsumerAtom = useMemo(
    () =>
      createAppControlRequestConsumerAtom({
        requestsAtom,
        clientId,
        connectionAtom,
        requestHandlerAtom,
        respond: (response) => respond({ environmentId, input: response }),
        label: `app-control:host:${environmentId}:${clientId}`,
      }),
    [clientId, connectionAtom, environmentId, requestHandlerAtom, requestsAtom, respond],
  );
  useAtomValue(requestConsumerAtom);

  useEffect(() => {
    if (connectionId === null) return;
    const report = () => {
      void focusHost({
        environmentId,
        input: {
          clientId,
          environmentId,
          connectionId,
          focused: isAppControlHostFocused(document),
        },
      });
    };
    const reportUnfocused = () => {
      void focusHost({
        environmentId,
        input: { clientId, environmentId, connectionId, focused: false },
      });
    };
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    window.addEventListener("pageshow", report);
    window.addEventListener("pagehide", reportUnfocused);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
      window.removeEventListener("pageshow", report);
      window.removeEventListener("pagehide", reportUnfocused);
      document.removeEventListener("visibilitychange", report);
    };
  }, [clientId, connectionId, environmentId, focusHost]);

  return null;
}
