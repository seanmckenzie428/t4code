import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AppViewId, AppViewRevision } from "./appViews.ts";
import { T3ProjectFile } from "./t3ProjectFile.ts";

const decode = Schema.decodeUnknownSync(T3ProjectFile);

describe("T3ProjectFile", () => {
  it("decodes a full project file", () => {
    const decoded = decode({
      $schema: "https://t3.codes/schema/t3.json",
      iconPath: "assets/logo.svg",
      scripts: [
        {
          name: "Dev",
          command: "pnpm dev",
          icon: "play",
          runOnWorktreeCreate: false,
          previewUrl: "http://localhost:3000",
          autoOpenPreview: true,
        },
        { name: "Test", command: "pnpm test" },
      ],
    });

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts).toHaveLength(2);
    expect(decoded.scripts?.[1]).toEqual({ name: "Test", command: "pnpm test" });
  });

  it("decodes an empty object and ignores unknown fields", () => {
    expect(decode({})).toEqual({});
    expect(decode({ futureField: true })).toEqual({});
  });

  it("trims icon paths and script fields", () => {
    const decoded = decode({
      iconPath: " assets/logo.svg ",
      scripts: [{ name: " Dev ", command: " pnpm dev " }],
    });

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev" });
  });

  it("rejects scripts without a command", () => {
    expect(() => decode({ scripts: [{ name: "Dev" }] })).toThrow();
  });

  it("rejects unknown script icons", () => {
    expect(() =>
      decode({ scripts: [{ name: "Dev", command: "pnpm dev", icon: "rocket" }] }),
    ).toThrow();
  });

  it("allows project extension requests without executable declarations", () => {
    const decoded = decode({
      extensions: [{ id: "lotus-runtime", config: { project: "lotus" } }],
    });
    expect(decoded.extensions).toEqual([{ id: "lotus-runtime", config: { project: "lotus" } }]);
    const stripped = decode({
      extensions: [{ id: "lotus-runtime", executable: "lotus", args: ["mcp"] }],
    });
    expect(stripped.extensions?.[0]).toEqual({ id: "lotus-runtime" });
  });

  it("validates project-saved generated views", () => {
    const decoded = decode({
      appViews: [
        {
          id: AppViewId.make("cockpit"),
          revision: AppViewRevision.make(1),
          title: "Cockpit",
          kind: "native",
          scope: { kind: "project" },
          root: { id: "root", type: "text", value: "Ready" },
        },
      ],
    });
    expect(decoded.appViews?.[0]?.id).toBe("cockpit");
  });
});
