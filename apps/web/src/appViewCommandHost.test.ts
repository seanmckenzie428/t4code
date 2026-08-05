import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AppCommandId } from "@t3tools/client-runtime/app-control";
import {
  AppViewId,
  AppViewRevision,
  type EnvironmentId,
  ProjectId,
  ThreadId,
  type NativeAppViewManifest,
  type SandboxedAppViewManifest,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { invokeWebAppCommand } from "./appCommandRegistry";
import {
  invokeGeneratedViewAction,
  parseOptionalExternalHttpUrl,
  registerAppViewCommandHost,
} from "./appViewCommandHost";
import { selectAppView, selectThreadAppViews, useAppViewStore } from "./appViewStore";
import { createExternalUrlApprovalStore } from "./externalUrlApprovals";
import { createMemoryStorage } from "./lib/storage";
import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));
const context = {
  environmentId: ref.environmentId,
  threadId: ref.threadId,
  projectId: "project-1",
  source: "mcp" as const,
};
const manifest: NativeAppViewManifest = {
  id: AppViewId.make("health"),
  revision: AppViewRevision.make(1),
  title: "Health",
  kind: "native",
  scope: { kind: "thread", threadId: ref.threadId },
  root: { id: "root", type: "text", value: "Ready" },
};

let unregister: (() => void) | null = null;

beforeEach(() => {
  useAppViewStore.setState({
    byThreadKey: {},
    personalByEnvironment: {},
    projectPinProposals: {},
  });
  useRightPanelStore.setState({ byThreadKey: {} });
  unregister = registerAppViewCommandHost();
});

afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("appViewCommandHost", () => {
  it("accepts an optional normalized browser URL", () => {
    expect(parseOptionalExternalHttpUrl({})).toBeUndefined();
    expect(parseOptionalExternalHttpUrl({ url: "HTTPS://EXAMPLE.COM:443/docs" })).toBe(
      "https://example.com/docs",
    );
    expect(() => parseOptionalExternalHttpUrl({ url: "file:///etc/passwd" })).toThrow(
      "HTTP or HTTPS",
    );
  });

  it("presents through the semantic registry and opens the dock", async () => {
    const first = await invokeWebAppCommand("view.present" as AppCommandId, context, {
      manifest,
    });
    const replay = await invokeWebAppCommand("view.present" as AppCommandId, context, {
      manifest,
    });

    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toEqual(manifest);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "app-view:health",
    });
    expect(first).toMatchObject({ idempotentReplay: false });
    expect(replay).toMatchObject({ idempotentReplay: true });
  });

  it("updates a matching logical view instead of creating a duplicate", async () => {
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest });

    const result = await invokeWebAppCommand("view.present" as AppCommandId, context, {
      manifest: {
        ...manifest,
        id: AppViewId.make("new-health-id"),
        title: " health ",
        root: { id: "root", type: "text", value: "Updated" },
      },
    });

    expect(
      Object.keys(selectThreadAppViews(useAppViewStore.getState().byThreadKey, ref).manifests),
    ).toEqual(["health"]);
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toMatchObject({
      revision: 2,
      root: { value: "Updated" },
    });
    expect(result).toMatchObject({ viewId: "health", revision: 2, updatedExisting: true });
  });

  it("creates a distinct matching-title view only when explicitly requested", async () => {
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest });
    await invokeWebAppCommand("view.present" as AppCommandId, context, {
      createNew: true,
      manifest: { ...manifest, id: AppViewId.make("health-2") },
    });

    expect(
      Object.keys(selectThreadAppViews(useAppViewStore.getState().byThreadKey, ref).manifests),
    ).toEqual(["health", "health-2"]);
  });

  it("rejects conflicting presents, stale updates, and mismatched update IDs", async () => {
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest });
    await expect(
      invokeWebAppCommand("view.present" as AppCommandId, context, {
        createNew: true,
        manifest: { ...manifest, title: "Different" },
      }),
    ).rejects.toThrow();
    await expect(
      invokeWebAppCommand("view.update" as AppCommandId, context, {
        viewId: "other",
        expectedRevision: 1,
        manifest: { ...manifest, revision: AppViewRevision.make(2) },
      }),
    ).rejects.toThrow("viewId must match");
    await expect(
      invokeWebAppCommand("view.update" as AppCommandId, context, {
        viewId: "health",
        expectedRevision: 0,
        manifest: { ...manifest, revision: AppViewRevision.make(2) },
      }),
    ).rejects.toThrow("revision changed");
  });

  it("copies personal pins and creates review-only project proposals", async () => {
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest });
    await invokeWebAppCommand("view.pin" as AppCommandId, context, {
      viewId: "health",
      scope: "personal",
    });
    expect(
      useAppViewStore.getState().personalByEnvironment[ref.environmentId]?.health?.scope,
    ).toEqual({ kind: "personal" });

    const result = await invokeWebAppCommand("view.pin" as AppCommandId, context, {
      viewId: "health",
      scope: "project",
      projectId: "project-1",
    });
    expect(result).toMatchObject({
      proposal: { configPath: "t3.json", status: "pending-review" },
    });
    expect(Object.values(useAppViewStore.getState().projectPinProposals)).toHaveLength(1);

    await invokeWebAppCommand("view.unpin" as AppCommandId, context, {
      viewId: "health",
      scope: "personal",
    });
    expect(useAppViewStore.getState().personalByEnvironment[ref.environmentId]).toBeUndefined();
  });

  it("rejects native actions referencing commands outside the registry", async () => {
    await expect(
      invokeWebAppCommand("view.present" as AppCommandId, context, {
        manifest: {
          ...manifest,
          root: {
            id: "root",
            type: "text",
            actions: [{ id: "bad", label: "Bad", commandId: "approval.respond" }],
          },
        },
      }),
    ).rejects.toThrow("unregistered command");
  });

  it("rejects unregistered commands nested in native action dropdowns", async () => {
    await expect(
      invokeWebAppCommand("view.present" as AppCommandId, context, {
        manifest: {
          ...manifest,
          root: {
            id: "root",
            type: "text",
            actions: [
              {
                id: "menu",
                label: "Menu",
                menu: [{ id: "bad", label: "Bad", commandId: "approval.respond" }],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("unregistered command");
  });

  it("opens only normalized HTTP(S) URLs through the semantic command", async () => {
    unregister?.();
    const open = vi.fn(async () => undefined);
    unregister = registerAppViewCommandHost(open);
    await expect(
      invokeWebAppCommand("ui.external-url.open" as AppCommandId, context, {
        url: "https://dev.admin.lotus.localhost/path",
      }),
    ).resolves.toEqual({ url: "https://dev.admin.lotus.localhost/path" });
    expect(open).toHaveBeenCalledWith("https://dev.admin.lotus.localhost/path");
    await expect(
      invokeWebAppCommand("ui.external-url.open" as AppCommandId, context, {
        url: "file:///etc/passwd",
      }),
    ).rejects.toThrow("HTTP or HTTPS");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens localhost generated-view URLs without confirmation", async () => {
    unregister?.();
    const open = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => false);
    const approvals = createExternalUrlApprovalStore(createMemoryStorage());
    unregister = registerAppViewCommandHost(open, confirm, approvals);
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "https://dev.api.lotus.localhost/local/dashboard" },
    );
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "http://127.9.8.7:3000/path" },
    );
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "http://[::1]:3000/path" },
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("remembers an exact normalized external URL after approval", async () => {
    unregister?.();
    const open = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    const approvals = createExternalUrlApprovalStore(createMemoryStorage());
    unregister = registerAppViewCommandHost(open, confirm, approvals);
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "HTTPS://EXAMPLE.COM:443/path" },
    );
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "https://example.com/path" },
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("https://example.com/path");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("confirms a different external URL and does not remember declines", async () => {
    unregister?.();
    const open = vi.fn(async () => undefined);
    const confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const approvals = createExternalUrlApprovalStore(createMemoryStorage());
    unregister = registerAppViewCommandHost(open, confirm, approvals);
    await invokeWebAppCommand(
      "ui.external-url.open" as AppCommandId,
      { ...context, source: "view" },
      { url: "https://example.com/one" },
    );
    await expect(
      invokeWebAppCommand(
        "ui.external-url.open" as AppCommandId,
        { ...context, source: "view" },
        { url: "https://example.com/two" },
      ),
    ).rejects.toThrow("declined");
    await expect(
      invokeWebAppCommand(
        "ui.external-url.open" as AppCommandId,
        { ...context, source: "view" },
        { url: "https://example.com/two" },
      ),
    ).rejects.toThrow("declined");
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("routes server-owned view buttons through authenticated server control", async () => {
    const invokeServer = vi.fn(async (input) => ({
      status: "completed" as const,
      receipt: {
        receiptId: "receipt-1",
        actionId: input.invocation.actionId,
        commandId: input.invocation.commandId,
        completedAt: "2026-01-01T00:00:00.000Z" as const,
        idempotentReplay: false,
      },
      result: { exitCode: 0 },
    }));
    await expect(
      invokeGeneratedViewAction({
        request: {
          commandId: "terminal.command.run" as AppCommandId,
          args: { command: "lotus tableplus dev" },
        },
        context: { ...context, source: "view" },
        principal: {
          kind: "thread-agent",
          projectId: ProjectId.make("project-1"),
          threadId: ref.threadId,
        },
        actionId: "view-action-1",
        invokeServer,
      }),
    ).resolves.toEqual({ exitCode: 0 });
    expect(invokeServer).toHaveBeenCalledWith({
      principal: {
        kind: "thread-agent",
        projectId: "project-1",
        threadId: "thread-1",
      },
      invocation: {
        actionId: "view-action-1",
        commandId: "terminal.command.run",
        args: { command: "lotus tableplus dev" },
      },
    });
  });

  it("close preserves the ephemeral manifest while delete removes it", async () => {
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest });
    await invokeWebAppCommand("view.close" as AppCommandId, context, { viewId: "health" });
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toEqual(manifest);

    await invokeWebAppCommand("view.delete" as AppCommandId, context, { viewId: "health" });
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toBeNull();
  });

  it("accepts opaque sandbox apps and rejects unapproved external origins", async () => {
    const sandboxed: SandboxedAppViewManifest = {
      id: AppViewId.make("sandbox"),
      revision: AppViewRevision.make(1),
      title: "Sandbox",
      kind: "sandboxed",
      scope: { kind: "thread", threadId: ref.threadId },
      html: "<script>document.body.textContent = 'isolated'</script>",
      commandIds: [],
    };
    await invokeWebAppCommand("view.present" as AppCommandId, context, { manifest: sandboxed });
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "sandbox")).toEqual(
      sandboxed,
    );

    await expect(
      invokeWebAppCommand("view.present" as AppCommandId, context, {
        manifest: { ...sandboxed, id: "networked", externalOrigins: ["https://example.com"] },
      }),
    ).rejects.toThrow("external origins require exact approval");

    await expect(
      invokeWebAppCommand("view.present" as AppCommandId, context, {
        manifest: {
          ...sandboxed,
          id: "remote",
          html: undefined,
          resource: {
            kind: "remote",
            uri: "https://apps.example.com/view",
            mimeType: "text/html",
          },
        },
      }),
    ).rejects.toThrow("Remote MCP App resources are unavailable");
  });
});
