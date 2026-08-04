import {
  getAppCommandCatalogEntry,
  isAppCommandId,
  validateAppCommandArguments,
  type AppCommandId,
} from "@t3tools/client-runtime/app-control";
import type { SandboxedAppViewManifest } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import type { AppViewActionRequest } from "./AppViewRenderer";

export const SANDBOXED_APP_VIEW_PROTOCOL = "t3.app-view/v1";
export const SANDBOXED_APP_VIEW_MAX_SEEN_REQUESTS = 256;

export const SANDBOXED_APP_VIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
  "base-uri 'none'",
].join("; ");

export const SANDBOXED_APP_VIEW_PERMISSIONS = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
].join("; ");

export interface SandboxedAppViewBridgeRequest {
  readonly type: "t3-app-command";
  readonly protocol: typeof SANDBOXED_APP_VIEW_PROTOCOL;
  readonly channelId: string;
  readonly viewId: string;
  readonly revision: number;
  readonly requestId: string;
  readonly commandId: AppCommandId;
  readonly args: unknown;
}

export interface SandboxedAppViewBridgeContext {
  readonly channelId: string;
  readonly viewId: string;
  readonly revision: number;
  readonly allowedCommandIds: ReadonlySet<string>;
  readonly seenRequestIds: Set<string>;
}

export function decodeSandboxedAppViewBridgeRequest(
  value: unknown,
  context: SandboxedAppViewBridgeContext,
): SandboxedAppViewBridgeRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type !== "t3-app-command" ||
    record.protocol !== SANDBOXED_APP_VIEW_PROTOCOL ||
    record.channelId !== context.channelId ||
    record.viewId !== context.viewId ||
    record.revision !== context.revision ||
    typeof record.requestId !== "string" ||
    record.requestId.length === 0 ||
    record.requestId.length > 128 ||
    context.seenRequestIds.has(record.requestId) ||
    typeof record.commandId !== "string" ||
    !context.allowedCommandIds.has(record.commandId) ||
    !isAppCommandId(record.commandId)
  ) {
    return null;
  }
  const descriptor = getAppCommandCatalogEntry(record.commandId)?.descriptor;
  const args = record.args ?? {};
  if (
    descriptor === undefined ||
    validateAppCommandArguments(descriptor.inputSchema, args) !== undefined
  ) {
    return null;
  }
  context.seenRequestIds.add(record.requestId);
  if (context.seenRequestIds.size > SANDBOXED_APP_VIEW_MAX_SEEN_REQUESTS) {
    const oldest = context.seenRequestIds.values().next().value;
    if (oldest !== undefined) context.seenRequestIds.delete(oldest);
  }
  return {
    type: "t3-app-command",
    protocol: SANDBOXED_APP_VIEW_PROTOCOL,
    channelId: context.channelId,
    viewId: context.viewId,
    revision: context.revision,
    requestId: record.requestId,
    commandId: record.commandId,
    args,
  };
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028");
}

export function sandboxDocument(
  html: string,
  identity: { readonly channelId: string; readonly viewId: string; readonly revision: number },
): string {
  const csp = SANDBOXED_APP_VIEW_CSP.replaceAll('"', "&quot;");
  const bridge = jsonForInlineScript({ protocol: SANDBOXED_APP_VIEW_PROTOCOL, ...identity });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><script>Object.defineProperty(window,"__T3_APP_VIEW__",{value:Object.freeze(${bridge}),writable:false,configurable:false});</script></head><body>${html}</body></html>`;
}

export function sandboxedAppViewApprovalIdentity(manifest: SandboxedAppViewManifest): string {
  return JSON.stringify({
    id: manifest.id,
    revision: manifest.revision,
    resource: manifest.resource ?? null,
    tool: manifest.tool ?? null,
    externalOrigins: [...(manifest.externalOrigins ?? [])].sort(),
  });
}

function newChannelId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function SandboxedAppView(props: {
  readonly manifest: SandboxedAppViewManifest;
  readonly onAction: (request: AppViewActionRequest) => void | Promise<void>;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const channelId = useMemo(() => newChannelId(), [props.manifest.id, props.manifest.revision]);
  const bridgeContext = useMemo<SandboxedAppViewBridgeContext>(
    () => ({
      channelId,
      viewId: props.manifest.id,
      revision: props.manifest.revision,
      allowedCommandIds: new Set<string>(props.manifest.commandIds),
      seenRequestIds: new Set(),
    }),
    [channelId, props.manifest.commandIds, props.manifest.id, props.manifest.revision],
  );

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameWindow || event.origin !== "null") return;
      const request = decodeSandboxedAppViewBridgeRequest(event.data, bridgeContext);
      if (!request) return;
      void Promise.resolve(props.onAction(request)).then(
        (result) =>
          frameWindow.postMessage(
            {
              type: "t3-app-command-result",
              protocol: SANDBOXED_APP_VIEW_PROTOCOL,
              channelId,
              viewId: props.manifest.id,
              revision: props.manifest.revision,
              requestId: request.requestId,
              ok: true,
              result,
            },
            "*",
          ),
        (error) =>
          frameWindow.postMessage(
            {
              type: "t3-app-command-result",
              protocol: SANDBOXED_APP_VIEW_PROTOCOL,
              channelId,
              viewId: props.manifest.id,
              revision: props.manifest.revision,
              requestId: request.requestId,
              ok: false,
              error: error instanceof Error ? error.message : "Command failed.",
            },
            "*",
          ),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridgeContext, channelId, props.manifest.id, props.manifest.revision, props.onAction]);

  if (props.manifest.resource?.kind === "remote") {
    return (
      <div className="p-4 text-sm text-muted-foreground" role="status">
        Remote MCP App resources are unavailable until their extension host is enabled.
      </div>
    );
  }
  if ((props.manifest.externalOrigins?.length ?? 0) > 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground" role="status">
        This MCP App requests external network access. It remains blocked until those exact origins
        are approved through the extension host.
      </div>
    );
  }

  return (
    <iframe
      key={`${props.manifest.id}:${props.manifest.revision}:${channelId}`}
      ref={frameRef}
      title={props.manifest.title}
      sandbox="allow-scripts"
      allow={SANDBOXED_APP_VIEW_PERMISSIONS}
      loading="lazy"
      referrerPolicy="no-referrer"
      srcDoc={sandboxDocument(props.manifest.html ?? "", {
        channelId,
        viewId: props.manifest.id,
        revision: props.manifest.revision,
      })}
      className="min-h-0 flex-1 border-0 bg-background"
      data-sandboxed-app-view={props.manifest.id}
      data-sandboxed-app-view-identity={sandboxedAppViewApprovalIdentity(props.manifest)}
    />
  );
}
