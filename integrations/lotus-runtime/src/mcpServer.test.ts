import { describe, expect, it } from "vite-plus/test";

import healthy from "../test/fixtures/healthy.json" with { type: "json" };
import { LotusCli } from "./lotusCli.ts";
import { LotusMcpServer, tools } from "./mcpServer.ts";
import { LotusWorkspaceProvider } from "./provider.ts";

const server = () =>
  new LotusMcpServer(
    new LotusWorkspaceProvider(
      new LotusCli({
        runner: {
          run: async () => ({ stdout: JSON.stringify(healthy), stderr: "" }),
        },
      }),
    ),
  );

describe("LotusMcpServer", () => {
  it("publishes a complete private workspace-provider tool mapping", () => {
    const providerTools = tools.filter(
      (tool) => "_meta" in tool && tool._meta["t3.workspace-provider/v1"] !== undefined,
    );
    expect(
      providerTools.map((tool) =>
        "_meta" in tool ? tool._meta["t3.workspace-provider/v1"].operation : undefined,
      ),
    ).toEqual(["detect", "list", "describe", "create", "list-actions", "invoke"]);
  });

  it("returns structured workspace data through MCP tools/call", async () => {
    const response = await server().handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "lotus_workspace_list", arguments: {} },
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: [{ id: "lotus-228" }] },
    });
  });

  it("does not register approval or user-input response tools", () => {
    expect(tools.some((tool) => /approval|user.input|user_input/.test(tool.name))).toBe(false);
  });
});
