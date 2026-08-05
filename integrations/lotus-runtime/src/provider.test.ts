import { describe, expect, it } from "vite-plus/test";

import drift from "../test/fixtures/drift.json" with { type: "json" };
import healthy from "../test/fixtures/healthy.json" with { type: "json" };
import longCreate from "../test/fixtures/long-create.json" with { type: "json" };
import malformed from "../test/fixtures/malformed.json" with { type: "json" };
import orphanAdopt from "../test/fixtures/orphan-adopt.json" with { type: "json" };
import unavailable from "../test/fixtures/unavailable.json" with { type: "json" };
import unhealthy from "../test/fixtures/unhealthy.json" with { type: "json" };
import { LotusCli } from "./lotusCli.ts";
import { LotusWorkspaceProvider } from "./provider.ts";
import type { LotusRunner } from "./types.ts";

const runner = (
  handler: (args: ReadonlyArray<string>) => Promise<unknown> | unknown,
): LotusRunner => ({
  run: async (_executable, args) => ({
    stdout: JSON.stringify(await handler(args)),
    stderr: "",
  }),
});

describe("LotusWorkspaceProvider", () => {
  it("maps healthy runtime identity, cockpit data, URLs, and workspace binding", async () => {
    const provider = new LotusWorkspaceProvider(new LotusCli({ runner: runner(() => healthy) }));
    const workspaces = await provider.list();
    expect(workspaces[0]).toMatchObject({
      id: "lotus-228",
      root: "/worktrees/lotus-228",
      status: "up",
      metadata: {
        branch: "feature/LOTUS-228",
        health: "healthy",
        adoptable: true,
        skipNativeBootstrap: true,
        workspaceBinding: {
          extensionId: "lotus-runtime",
          providerId: "lotus",
          workspaceId: "lotus-228",
        },
      },
    });
  });

  it("keeps unhealthy and drift state visible in cockpit metadata", async () => {
    const unhealthyProvider = new LotusWorkspaceProvider(
      new LotusCli({ runner: runner(() => unhealthy) }),
    );
    const unhealthyDetail = await unhealthyProvider.describe("broken-checkout");
    expect(unhealthyDetail.workspace.metadata).toMatchObject({ health: "unhealthy" });

    const driftProvider = new LotusWorkspaceProvider(new LotusCli({ runner: runner(() => drift) }));
    const driftDetail = await driftProvider.describe("drifted-stack");
    expect(driftDetail.workspace.metadata).toMatchObject({
      drift: { detected: true, codes: ["compose_override_stale", "generated_env_stale"] },
    });
  });

  it("detects exact worktree paths and exposes existing orphan stacks for adoption", async () => {
    const provider = new LotusWorkspaceProvider(
      new LotusCli({ runner: runner(() => orphanAdopt) }),
    );
    await expect(provider.detect("/worktrees/orphaned-create")).resolves.toMatchObject({
      detected: true,
      workspaceId: "orphaned-create",
    });
    await expect(provider.list()).resolves.toMatchObject([
      { id: "orphaned-create", metadata: { adoptable: true, skipNativeBootstrap: true } },
    ]);
  });

  it("uses exact argv, --json, no shell runner surface, and idempotent operation receipts", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const provider = new LotusWorkspaceProvider(
      new LotusCli({
        runner: runner((args) => {
          calls.push(args);
          return longCreate;
        }),
      }),
    );
    const input = { slug: "long-create", branch: "feature/long-create", operationId: "op-1" };
    const first = await provider.create(input);
    const second = await provider.create(input);
    expect(first).toEqual(second);
    expect(calls).toEqual([["create", "long-create", "--branch", "feature/long-create", "--json"]]);
    expect(first).toMatchObject({
      operationId: "op-1",
      status: "completed",
      result: { adoptable: true, skipNativeBootstrap: true, ownership: "lotus-runtime" },
    });
  });

  it("marks fresh-db, replacement clone, and trash destructive", () => {
    const provider = new LotusWorkspaceProvider(new LotusCli({ runner: runner(() => ({})) }));
    expect(
      provider
        .listActions()
        .filter((action) => ["fresh-db", "clone-db-replace", "trash"].includes(action.id)),
    ).toEqual([
      expect.objectContaining({ id: "fresh-db", risk: "destructive" }),
      expect.objectContaining({ id: "clone-db-replace", risk: "destructive" }),
      expect.objectContaining({ id: "trash", risk: "destructive" }),
    ]);
  });

  it("builds canonical destructive argv only after host authorization", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const provider = new LotusWorkspaceProvider(
      new LotusCli({
        runner: runner((args) => {
          calls.push(args);
          return { ok: true };
        }),
      }),
    );
    await provider.invoke("lotus-228", "fresh-db", { operationId: "fresh" });
    await provider.invoke("lotus-228", "clone-db-replace", {
      operationId: "clone",
      source: "production",
    });
    await provider.invoke("lotus-228", "trash", {
      operationId: "trash",
      keepWorktree: true,
    });
    expect(calls).toEqual([
      ["fresh-db", "lotus-228", "--json"],
      ["clone-db", "lotus-228", "--source", "production", "--replace", "--json"],
      ["trash", "lotus-228", "--keep-worktree", "--json"],
    ]);
  });

  it("reports unavailable CLI and malformed output without leaking stderr", async () => {
    const unavailableRunner: LotusRunner = {
      run: async () => {
        const cause = Object.assign(new Error(unavailable.error.message), {
          code: unavailable.error.code,
        });
        throw cause;
      },
    };
    const cli = new LotusCli({ runner: unavailableRunner });
    await expect(cli.runJson(["list"])).rejects.toMatchObject({
      kind: "unavailable",
      message: "Lotus Runtime CLI is not installed or is not available on PATH.",
    });

    const malformedRunner: LotusRunner = {
      run: async () => ({ stdout: malformed.stdout, stderr: "secret diagnostic" }),
    };
    await expect(new LotusCli({ runner: malformedRunner }).runJson(["list"])).rejects.toMatchObject(
      {
        kind: "malformed-output",
        message: "Lotus Runtime returned malformed JSON.",
      },
    );
  });
});
