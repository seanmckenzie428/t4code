import {
  getAppCommandCatalogEntry,
  isAppCommandId,
  type AppCommandId,
} from "@t3tools/client-runtime/app-control";
import {
  AppActionId,
  AppCommandId as AppCommandIdSchema,
  AppViewManifest,
  type AppCommandResult,
  type AppControlPrincipal,
  type AppControlServerInvocation,
  type EnvironmentId,
  ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  invokeWebAppCommand,
  registerWebAppCommandHandler,
  type WebAppCommandContext,
} from "./appCommandRegistry";
import { selectThreadAppViews, useAppViewStore } from "./appViewStore";
import {
  defaultExternalUrlApprovalStore,
  isLoopbackHttpUrl,
  type ExternalUrlApprovalStore,
} from "./externalUrlApprovals";
import { ensureLocalApi } from "./localApi";
import { useRightPanelStore } from "./rightPanelStore";

function commandId(value: string): AppCommandId {
  return value as AppCommandId;
}

export async function invokeGeneratedViewAction(input: {
  readonly request: { readonly commandId: AppCommandId; readonly args: unknown };
  readonly context: WebAppCommandContext;
  readonly principal: AppControlPrincipal;
  readonly actionId: string;
  readonly invokeServer: (input: AppControlServerInvocation) => Promise<AppCommandResult>;
}): Promise<unknown> {
  const descriptor = getAppCommandCatalogEntry(input.request.commandId)?.descriptor;
  if (descriptor === undefined || descriptor.risk === "forbidden") {
    throw new Error(`Generated view action uses unavailable command ${input.request.commandId}.`);
  }
  if (descriptor.owner === "client") {
    return await invokeWebAppCommand(input.request.commandId, input.context, input.request.args);
  }
  const result = await input.invokeServer({
    principal: input.principal,
    invocation: {
      actionId: AppActionId.make(input.actionId),
      commandId: AppCommandIdSchema.make(input.request.commandId),
      args: input.request.args,
    },
  });
  switch (result.status) {
    case "completed":
      return result.result;
    case "declined":
      throw new Error("The command was declined.");
    case "failed":
      throw new Error(result.error.message);
  }
}

function objectArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Generated view command arguments must be an object.");
  }
  return args as Record<string, unknown>;
}

export function parseExternalHttpUrl(args: unknown): string {
  const url = objectArgs(args).url;
  if (typeof url !== "string") throw new Error("External URL command requires url.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("External URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("External URL must use HTTP or HTTPS.");
  }
  return parsed.href;
}

function threadRef(context: { environmentId: string; threadId?: string }): ScopedThreadRef {
  if (!context.threadId) throw new Error("Generated views require a thread-scoped command.");
  return {
    environmentId: context.environmentId as EnvironmentId,
    threadId: context.threadId as ThreadId,
  };
}

function decodeManifest(args: unknown): AppViewManifest {
  const record = objectArgs(args);
  const candidate = "manifest" in record ? record.manifest : record;
  const manifest = Schema.decodeUnknownSync(AppViewManifest)(candidate);
  if (manifest.kind === "sandboxed" && manifest.resource?.kind === "remote") {
    throw new Error(
      "Remote MCP App resources are unavailable until the extension host is enabled.",
    );
  }
  if (manifest.kind === "sandboxed" && (manifest.externalOrigins?.length ?? 0) > 0) {
    throw new Error(
      "Sandboxed view external origins require exact approval through the extension host.",
    );
  }
  if (manifest.kind === "native") {
    const pending = [manifest.root];
    while (pending.length > 0) {
      const node = pending.pop();
      if (!node) continue;
      for (const action of node.actions ?? []) {
        if (!isAppCommandId(action.commandId)) {
          throw new Error(`Generated view action uses unregistered command ${action.commandId}.`);
        }
      }
      pending.push(...(node.children ?? []));
    }
  }
  return manifest;
}

function viewIdFromArgs(args: unknown): string {
  const viewId = objectArgs(args).viewId;
  if (typeof viewId !== "string" || viewId.trim().length === 0) {
    throw new Error("Generated view command requires viewId.");
  }
  return viewId;
}

function logicalViewTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function pinArgs(args: unknown): {
  viewId: string;
  scope: "personal" | "project";
  projectId?: ProjectId;
} {
  const record = objectArgs(args);
  const viewId = viewIdFromArgs(args);
  if (record.scope !== "personal" && record.scope !== "project") {
    throw new Error("Generated view pin requires personal or project scope.");
  }
  if (record.scope === "project") {
    if (typeof record.projectId !== "string" || record.projectId.trim().length === 0) {
      throw new Error("Project view pin requires projectId.");
    }
    return { viewId, scope: record.scope, projectId: ProjectId.make(record.projectId) };
  }
  return { viewId, scope: record.scope };
}

export function registerAppViewCommandHost(
  openExternal: (url: string) => Promise<void> = (url) => ensureLocalApi().shell.openExternal(url),
  confirmExternal: (url: string) => Promise<boolean> = (url) =>
    ensureLocalApi().dialogs.confirm(`Open this external URL?\n\n${url}`),
  externalUrlApprovals: ExternalUrlApprovalStore = defaultExternalUrlApprovalStore(),
): () => void {
  const unregister = [
    registerWebAppCommandHandler(commandId("ui.external-url.open"), async (invocation, context) => {
      const url = parseExternalHttpUrl(invocation.args);
      if (context.source !== "mcp" && !isLoopbackHttpUrl(url) && !externalUrlApprovals.has(url)) {
        if (!(await confirmExternal(url))) {
          throw new Error("External URL opening was declined.");
        }
        externalUrlApprovals.approve(url);
      }
      await openExternal(url);
      return { url };
    }),
    registerWebAppCommandHandler(commandId("view.present"), (invocation, context) => {
      const ref = threadRef(context);
      const manifest = decodeManifest(invocation.args);
      const record = objectArgs(invocation.args);
      const createNew = record.createNew === true;
      const threadManifests = selectThreadAppViews(
        useAppViewStore.getState().byThreadKey,
        ref,
      ).manifests;
      const directMatch = threadManifests?.[manifest.id];
      const logicalMatch = createNew
        ? undefined
        : Object.values(threadManifests ?? {}).find(
            (candidate) =>
              candidate.kind === manifest.kind &&
              logicalViewTitle(candidate.title) === logicalViewTitle(manifest.title),
          );
      const existing = directMatch ?? logicalMatch;
      if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) {
        if (createNew) {
          throw new Error("A distinct generated view must use a unique view ID.");
        }
        const updated = {
          ...manifest,
          id: existing.id,
          revision: Math.max(existing.revision + 1, manifest.revision),
        } as AppViewManifest;
        if (!useAppViewStore.getState().update(ref, updated, existing.revision)) {
          throw new Error("Generated view revision changed or the view no longer exists.");
        }
        useRightPanelStore.getState().openAppView(ref, updated.id);
        return {
          viewId: updated.id,
          revision: updated.revision,
          idempotentReplay: false,
          updatedExisting: true,
        };
      }
      const result = useAppViewStore.getState().present(ref, manifest);
      if (result === "conflict") {
        throw new Error("Generated view conflicts with an existing view or target thread.");
      }
      useRightPanelStore.getState().openAppView(ref, manifest.id);
      return {
        viewId: manifest.id,
        revision: manifest.revision,
        idempotentReplay: result === "replayed",
        updatedExisting: false,
      };
    }),
    registerWebAppCommandHandler(commandId("view.update"), (invocation, context) => {
      const ref = threadRef(context);
      const manifest = decodeManifest(invocation.args);
      const record = objectArgs(invocation.args);
      if (record.viewId !== manifest.id) {
        throw new Error("Generated view update viewId must match manifest.id.");
      }
      const expectedRevision = invocation.expectedRevision ?? record.expectedRevision;
      if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)) {
        throw new Error("Generated view update requires expectedRevision.");
      }
      if (!useAppViewStore.getState().update(ref, manifest, expectedRevision)) {
        throw new Error("Generated view revision changed or the view no longer exists.");
      }
      useRightPanelStore.getState().openAppView(ref, manifest.id);
      return { viewId: manifest.id, revision: manifest.revision };
    }),
    registerWebAppCommandHandler(commandId("view.close"), (invocation, context) => {
      const ref = threadRef(context);
      const viewId = viewIdFromArgs(invocation.args);
      useRightPanelStore.getState().closeSurface(ref, `app-view:${viewId}`);
      return { viewId };
    }),
    registerWebAppCommandHandler(commandId("view.pin"), (invocation, context) => {
      const ref = threadRef(context);
      const input = pinArgs(invocation.args);
      if (input.scope === "personal") {
        if (!useAppViewStore.getState().pinPersonal(ref, input.viewId)) {
          throw new Error("Generated view no longer exists.");
        }
        return { viewId: input.viewId, scope: input.scope };
      }
      if (!input.projectId || context.projectId !== input.projectId) {
        throw new Error("Project view pin must target the current project.");
      }
      const proposal = useAppViewStore.getState().pinProject(ref, input.viewId, input.projectId);
      if (!proposal) throw new Error("Generated view no longer exists.");
      return { viewId: input.viewId, scope: input.scope, proposal };
    }),
    registerWebAppCommandHandler(commandId("view.unpin"), (invocation, context) => {
      const ref = threadRef(context);
      const input = pinArgs(invocation.args);
      const removed =
        input.scope === "personal"
          ? useAppViewStore.getState().unpinPersonal(ref, input.viewId)
          : Boolean(
              input.projectId &&
              context.projectId === input.projectId &&
              useAppViewStore.getState().unpinProject(ref, input.viewId, input.projectId),
            );
      if (!removed) throw new Error("Generated view pin no longer exists.");
      return { viewId: input.viewId, scope: input.scope };
    }),
    registerWebAppCommandHandler(commandId("view.delete"), (invocation, context) => {
      const ref = threadRef(context);
      const viewId = viewIdFromArgs(invocation.args);
      useAppViewStore.getState().remove(ref, viewId);
      return { viewId };
    }),
  ];
  return () => unregister.forEach((cleanup) => cleanup());
}
