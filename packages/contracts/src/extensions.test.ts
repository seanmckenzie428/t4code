import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  InstalledExtension,
  ObservedWorkspaceProjection,
  WorkspaceProviderMetadataKey,
} from "./extensions.ts";

describe("extension contracts", () => {
  const decode = Schema.decodeUnknownSync(InstalledExtension);

  it("defaults new installations disabled and unapproved", () => {
    expect(
      decode({
        id: "lotus-runtime",
        title: "Lotus Runtime",
        transport: { kind: "stdio", executable: "lotus", args: ["mcp"] },
        requestedCapabilities: ["tools", "workspace-provider"],
      }),
    ).toMatchObject({ enabled: false, approval: null });
  });

  it("supports streamable HTTP without permitting a command", () => {
    const extension = decode({
      id: "remote-tools",
      title: "Remote tools",
      transport: { kind: "streamable-http", url: "https://example.test/mcp" },
    });
    expect(extension.transport).toEqual({
      kind: "streamable-http",
      url: "https://example.test/mcp",
    });
  });

  it("defines the private workspace provider metadata key and stale projection", () => {
    expect(WorkspaceProviderMetadataKey).toBe("t3.workspace-provider/v1");
    const projection = Schema.decodeUnknownSync(ObservedWorkspaceProjection)({
      extensionId: "lotus-runtime",
      providerId: "lotus",
      workspace: { id: "orders", title: "Orders" },
      observedAt: "2026-08-01T12:00:00.000Z",
      stale: true,
    });
    expect(projection.stale).toBe(true);
  });
});
