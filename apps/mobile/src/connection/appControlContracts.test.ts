import {
  AppControlStreamEvent,
  AppViewManifest,
  type AppControlStreamEvent as AppControlStreamEventType,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

const decodeAppControlStreamEvent = Schema.decodeUnknownSync(AppControlStreamEvent);
const decodeAppViewManifest = Schema.decodeUnknownSync(AppViewManifest);

describe("mobile app-control compatibility", () => {
  it("decodes host events as inert shared contracts", () => {
    const connected: AppControlStreamEventType = decodeAppControlStreamEvent({
      type: "connected",
      connectionId: "connection-1",
    });
    const request: AppControlStreamEventType = decodeAppControlStreamEvent({
      type: "request",
      connectionId: "connection-1",
      request: {
        requestId: "request-1",
        actionId: "action-1",
        principal: {
          kind: "thread-agent",
          threadId: "thread-1",
          projectId: "project-1",
        },
        commandId: "ui.diff.open",
        args: {},
        timeoutMs: 15_000,
      },
    });

    expect(connected.type).toBe("connected");
    expect(request.type).toBe("request");
    if (request.type === "request") expect(request.request.commandId).toBe("ui.diff.open");
  });

  it("decodes generated views without exposing a mobile command host", () => {
    const manifest = decodeAppViewManifest({
      id: "health",
      revision: 1,
      title: "Health",
      kind: "native",
      scope: { kind: "thread", threadId: "thread-1" },
      root: { id: "root", type: "metric", value: 3 },
    });

    expect(manifest.kind).toBe("native");
    // Mobile intentionally has no generated-view renderer or app-control host.
    expect("appViewEnvironment" in globalThis).toBe(false);
  });

  it("decodes sandboxed resource metadata but exposes no renderer", () => {
    const manifest = decodeAppViewManifest({
      id: "rich",
      revision: 1,
      title: "Rich view",
      kind: "sandboxed",
      scope: { kind: "thread", threadId: "thread-1" },
      resource: {
        kind: "remote",
        uri: "https://apps.example.com/view",
        mimeType: "text/html",
      },
      tool: { name: "example", resourceUri: "https://apps.example.com/view" },
      commandIds: [],
    });

    expect(manifest.kind).toBe("sandboxed");
    expect("appViewEnvironment" in globalThis).toBe(false);
  });
});
