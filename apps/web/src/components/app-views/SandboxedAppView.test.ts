import { AppViewId, AppViewRevision, type SandboxedAppViewManifest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decodeSandboxedAppViewBridgeRequest,
  SANDBOXED_APP_VIEW_CSP,
  SANDBOXED_APP_VIEW_PERMISSIONS,
  SANDBOXED_APP_VIEW_PROTOCOL,
  sandboxDocument,
  sandboxedAppViewApprovalIdentity,
  type SandboxedAppViewBridgeContext,
} from "./SandboxedAppView";

const context = (): SandboxedAppViewBridgeContext => ({
  channelId: "secret-channel",
  viewId: "sandbox",
  revision: 3,
  allowedCommandIds: new Set(["quick-chat.toggle", "ui.project.select"]),
  seenRequestIds: new Set(),
});

const request = {
  type: "t3-app-command",
  protocol: SANDBOXED_APP_VIEW_PROTOCOL,
  channelId: "secret-channel",
  viewId: "sandbox",
  revision: 3,
  requestId: "request-1",
  commandId: "quick-chat.toggle",
  args: {},
} as const;

describe("SandboxedAppView", () => {
  it("uses default-deny CSP and iframe permissions", () => {
    expect(SANDBOXED_APP_VIEW_CSP).toContain("default-src 'none'");
    expect(SANDBOXED_APP_VIEW_CSP).toContain("connect-src 'none'");
    expect(SANDBOXED_APP_VIEW_CSP).toContain("navigate-to 'none'");
    expect(SANDBOXED_APP_VIEW_CSP).toContain("form-action 'none'");
    expect(SANDBOXED_APP_VIEW_PERMISSIONS).toContain("camera 'none'");
    expect(SANDBOXED_APP_VIEW_PERMISSIONS).toContain("clipboard-write 'none'");
  });

  it("binds requests to protocol, opaque channel, view, and revision", () => {
    expect(decodeSandboxedAppViewBridgeRequest(request, context())).toMatchObject({
      commandId: "quick-chat.toggle",
      requestId: "request-1",
    });
    for (const mutation of [
      { protocol: "other" },
      { channelId: "stolen" },
      { viewId: "other" },
      { revision: 2 },
      { requestId: "" },
    ]) {
      expect(
        decodeSandboxedAppViewBridgeRequest({ ...request, ...mutation }, context()),
      ).toBeNull();
    }
  });

  it("rejects replayed requests and confused-deputy commands", () => {
    const bridge = context();
    expect(decodeSandboxedAppViewBridgeRequest(request, bridge)).not.toBeNull();
    expect(decodeSandboxedAppViewBridgeRequest(request, bridge)).toBeNull();
    expect(
      decodeSandboxedAppViewBridgeRequest(
        { ...request, requestId: "request-2", commandId: "project.delete" },
        context(),
      ),
    ).toBeNull();
    expect(
      decodeSandboxedAppViewBridgeRequest(
        { ...request, requestId: "request-3", commandId: "approval.respond" },
        { ...context(), allowedCommandIds: new Set(["approval.respond"]) },
      ),
    ).toBeNull();
  });

  it("rejects schema-invalid arguments before dispatch", () => {
    expect(
      decodeSandboxedAppViewBridgeRequest(
        {
          ...request,
          requestId: "request-2",
          commandId: "ui.project.select",
          args: {},
        },
        context(),
      ),
    ).toBeNull();
    expect(
      decodeSandboxedAppViewBridgeRequest(
        {
          ...request,
          requestId: "request-3",
          commandId: "ui.project.select",
          args: { projectId: "project-1" },
        },
        context(),
      ),
    ).toMatchObject({ commandId: "ui.project.select" });
  });

  it("injects frozen bridge identity before untrusted HTML", () => {
    const document = sandboxDocument("<script>window.test = __T3_APP_VIEW__</script>", {
      channelId: "secret-channel",
      viewId: "sandbox",
      revision: 3,
    });
    expect(document.indexOf("Object.defineProperty")).toBeLessThan(document.indexOf("window.test"));
    expect(document).toContain("secret-channel");
    expect(document).toContain("default-src 'none'");
  });

  it("invalidates exact-origin approval identity when manifest identity changes", () => {
    const manifest: SandboxedAppViewManifest = {
      id: AppViewId.make("sandbox"),
      revision: AppViewRevision.make(1),
      title: "Sandbox",
      kind: "sandboxed",
      scope: { kind: "personal" },
      html: "<p>ok</p>",
      resource: { kind: "bundled", uri: "ui://tool/view", mimeType: "text/html" },
      tool: { name: "tool", resourceUri: "ui://tool/view" },
      commandIds: [],
      externalOrigins: ["https://api.example.com"],
    };
    const approved = sandboxedAppViewApprovalIdentity(manifest);
    expect(
      sandboxedAppViewApprovalIdentity({
        ...manifest,
        revision: AppViewRevision.make(2),
      }),
    ).not.toBe(approved);
    expect(
      sandboxedAppViewApprovalIdentity({
        ...manifest,
        externalOrigins: ["https://other.example.com"],
      }),
    ).not.toBe(approved);
  });
});
