// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Standalone extension receipt IDs.
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import { isRecord, LotusCli } from "./lotusCli.ts";
import type {
  AsyncWorkspaceOperation,
  JsonRecord,
  WorkspaceAction,
  WorkspaceDescriptor,
} from "./types.ts";

const stringValue = (record: JsonRecord, ...keys: ReadonlyArray<string>): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
};

const recordValue = (record: JsonRecord, key: string): JsonRecord | undefined => {
  const value = record[key];
  return isRecord(value) ? value : undefined;
};

const arrayValue = (record: JsonRecord, key: string): ReadonlyArray<unknown> => {
  const value = record[key];
  return Array.isArray(value) ? value : [];
};

const workspaceRows = (value: unknown): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) throw new Error("Lotus Runtime list result is not an object or array.");
  for (const key of ["workspaces", "stacks", "items"]) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows;
  }
  if (isRecord(value.workspace)) return [value.workspace];
  throw new Error("Lotus Runtime list result does not contain workspaces.");
};

const normalizeUrls = (row: JsonRecord): JsonRecord => {
  const source = recordValue(row, "urls") ?? {};
  const urls: JsonRecord = {};
  for (const [target, aliases] of Object.entries({
    admin: ["admin", "admin_url"],
    api: ["api", "api_url"],
    dashboard: ["dashboard", "dashboard_url"],
    storefront: ["storefront", "store", "storefront_url", "store_url"],
    mail: ["mail", "mail_url"],
  })) {
    const value = stringValue(source, ...aliases) ?? stringValue(row, ...aliases);
    if (value !== undefined) urls[target] = value;
  }
  return urls;
};

export const toWorkspaceDescriptor = (value: unknown): WorkspaceDescriptor => {
  if (!isRecord(value)) throw new Error("Lotus Runtime workspace is not an object.");
  const id = stringValue(value, "slug", "workspace_id", "id");
  if (id === undefined) throw new Error("Lotus Runtime workspace is missing its slug.");
  const root = stringValue(value, "worktree_path", "root", "path");
  const status = stringValue(value, "status", "state");
  const branch = stringValue(value, "branch", "branch_name");
  const metadata: JsonRecord = {
    providerId: "lotus",
    workspaceBinding: {
      extensionId: "lotus-runtime",
      providerId: "lotus",
      workspaceId: id,
    },
    ...(branch === undefined ? {} : { branch }),
    health: value.health ?? null,
    checks: arrayValue(value, "checks"),
    commands: arrayValue(value, "commands"),
    urls: normalizeUrls(value),
    drift: value.drift ?? null,
    warnings: arrayValue(value, "warnings"),
    adoptable: true,
    skipNativeBootstrap: true,
  };
  return {
    id,
    title: stringValue(value, "title", "name") ?? id,
    ...(root === undefined ? {} : { root }),
    ...(status === undefined ? {} : { status }),
    metadata,
  };
};

const objectSchema = (properties: JsonRecord = {}, required: ReadonlyArray<string> = []) =>
  ({ type: "object", additionalProperties: false, properties, required }) satisfies JsonRecord;

const actions: ReadonlyArray<WorkspaceAction> = [
  { id: "explain", title: "Explain workspace", risk: "observe", inputSchema: objectSchema() },
  { id: "todo-list", title: "List todos", risk: "observe", inputSchema: objectSchema() },
  { id: "resume", title: "Resume stack", risk: "mutate", inputSchema: objectSchema() },
  { id: "down", title: "Stop stack", risk: "mutate", inputSchema: objectSchema() },
  {
    id: "recreate",
    title: "Recreate services",
    risk: "mutate",
    inputSchema: objectSchema({
      services: { type: "array", items: { type: "string" }, maxItems: 32 },
      build: { type: "boolean" },
    }),
  },
  {
    id: "fresh-db",
    title: "Fresh database",
    description: "Destroys and reseeds the workspace database. Confirmation cannot be remembered.",
    risk: "destructive",
    inputSchema: objectSchema(),
  },
  {
    id: "clone-db-replace",
    title: "Replace database clone",
    description: "Replaces the active database with an anonymized runtime clone.",
    risk: "destructive",
    inputSchema: objectSchema({ source: { type: "string", minLength: 1 } }, ["source"]),
  },
  {
    id: "trash",
    title: "Trash workspace",
    description: "Removes the runtime stack and normally its worktree.",
    risk: "destructive",
    inputSchema: objectSchema({
      force: { type: "boolean" },
      keepWorktree: { type: "boolean" },
    }),
  },
  {
    id: "logs",
    title: "Open logs in terminal",
    risk: "external",
    inputSchema: objectSchema({
      services: { type: "array", items: { type: "string" }, maxItems: 32 },
      follow: { type: "boolean" },
    }),
  },
  ...(["admin", "api", "dashboard", "storefront", "mail"] as const).map(
    (target): WorkspaceAction => ({
      id: `open-${target}`,
      title: `Open ${target}`,
      risk: "external",
      inputSchema: objectSchema(),
    }),
  ),
];

const argsRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {});
const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const safeSegment = (value: string, label: string): string => {
  if (value === "" || value.startsWith("-") || value.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const operationId = (input: JsonRecord): string =>
  typeof input.operationId === "string" && input.operationId.trim() !== ""
    ? input.operationId
    : NodeCrypto.randomUUID();

export class LotusWorkspaceProvider {
  readonly providerId = "lotus";
  readonly #cli: LotusCli;
  readonly #operations = new Map<string, Promise<AsyncWorkspaceOperation>>();

  constructor(cli = new LotusCli()) {
    this.#cli = cli;
  }

  async status(slug?: string): Promise<unknown> {
    return this.#cli.runJson(
      slug === undefined ? ["status"] : ["status", safeSegment(slug, "slug")],
    );
  }

  async list(): Promise<ReadonlyArray<WorkspaceDescriptor>> {
    const result = await this.#cli.runJson(["list"]);
    return workspaceRows(result).map(toWorkspaceDescriptor);
  }

  async explain(slug: string): Promise<unknown> {
    return this.#cli.runJson(["explain", safeSegment(slug, "slug")]);
  }

  async todoList(slug: string): Promise<unknown> {
    return this.#cli.runJson(["todo", "list", safeSegment(slug, "slug")]);
  }

  async detect(projectRoot: string) {
    const normalizedRoot = NodePath.resolve(projectRoot);
    const workspaces = await this.list();
    const workspace = workspaces.find(
      (candidate) =>
        candidate.root !== undefined && NodePath.resolve(candidate.root) === normalizedRoot,
    );
    return workspace === undefined
      ? { detected: false, confidence: 0, reason: "No Lotus workspace owns this project root." }
      : {
          detected: true,
          confidence: 1,
          workspaceId: workspace.id,
          reason: "Project root matches the Lotus Runtime worktree path.",
        };
  }

  async describe(workspaceId: string) {
    const slug = safeSegment(workspaceId, "workspaceId");
    const raw = await this.explain(slug);
    let row: unknown = raw;
    if (isRecord(raw)) row = raw.workspace ?? raw.stack ?? raw;
    const workspace = toWorkspaceDescriptor(row);
    return {
      workspace,
      actions: actions.map((action) => action.id),
      detail: {
        cockpit: workspace.metadata,
        raw,
      },
    };
  }

  async create(input: unknown): Promise<AsyncWorkspaceOperation> {
    const args = argsRecord(input);
    const slugValue = typeof args.slug === "string" ? safeSegment(args.slug, "slug") : undefined;
    if (slugValue === undefined) throw new Error("slug is required.");
    const command = ["create", slugValue];
    if (typeof args.branch === "string")
      command.push("--branch", safeSegment(args.branch, "branch"));
    return this.#runOperation(args, slugValue, command, async (result) => ({
      runtime: result,
      workspaceBinding: {
        extensionId: "lotus-runtime",
        providerId: "lotus",
        workspaceId: slugValue,
      },
      adoptable: true,
      skipNativeBootstrap: true,
      ownership: "lotus-runtime",
    }));
  }

  listActions(): ReadonlyArray<WorkspaceAction> {
    return actions;
  }

  async invoke(
    workspaceId: string,
    actionId: string,
    input: unknown,
  ): Promise<AsyncWorkspaceOperation> {
    const slug = safeSegment(workspaceId, "workspaceId");
    const args = argsRecord(input);
    if (actionId === "explain") return this.#completed(args, slug, await this.explain(slug));
    if (actionId === "todo-list") return this.#completed(args, slug, await this.todoList(slug));
    if (actionId === "logs") {
      const command = [
        "lotus",
        "logs",
        slug,
        ...stringArray(args.services).map((service) => safeSegment(service, "service")),
      ];
      if (args.follow === true) command.push("--follow");
      return this.#completed(args, slug, {
        handoff: { kind: "visible-terminal", argv: command },
      });
    }
    if (actionId.startsWith("open-")) {
      const target = actionId.slice("open-".length);
      const detail = await this.describe(slug);
      const cockpit =
        isRecord(detail.detail) && isRecord(detail.detail.cockpit) ? detail.detail.cockpit : {};
      const urls = isRecord(cockpit.urls) ? cockpit.urls : {};
      const url = urls[target];
      if (typeof url !== "string") throw new Error(`Lotus Runtime did not report a ${target} URL.`);
      return this.#completed(args, slug, {
        handoff: { kind: target === "dashboard" ? "preview" : "open-url", url },
      });
    }

    const command = this.#mutationCommand(slug, actionId, args);
    return this.#runOperation(args, slug, command, async (result) => ({
      runtime: result,
      ownership: "lotus-runtime",
    }));
  }

  getOperation(id: string): Promise<AsyncWorkspaceOperation> | undefined {
    return this.#operations.get(id);
  }

  #mutationCommand(slug: string, actionId: string, args: JsonRecord): ReadonlyArray<string> {
    switch (actionId) {
      case "resume":
        return ["resume", slug];
      case "down":
        return ["down", slug];
      case "recreate": {
        const command = [
          "recreate",
          slug,
          ...stringArray(args.services).map((service) => safeSegment(service, "service")),
        ];
        if (args.build === true) command.push("--build");
        return command;
      }
      case "fresh-db":
        return ["fresh-db", slug];
      case "clone-db-replace": {
        if (typeof args.source !== "string") throw new Error("source is required.");
        return ["clone-db", slug, "--source", safeSegment(args.source, "source"), "--replace"];
      }
      case "trash": {
        const command = ["trash", slug];
        if (args.force === true) command.push("--force");
        if (args.keepWorktree === true) command.push("--keep-worktree");
        return command;
      }
      default:
        throw new Error(`Unknown Lotus workspace action: ${actionId}`);
    }
  }

  #completed(input: JsonRecord, workspaceId: string, result: unknown): AsyncWorkspaceOperation {
    return { operationId: operationId(input), status: "completed", workspaceId, result };
  }

  #runOperation(
    input: JsonRecord,
    workspaceId: string,
    command: ReadonlyArray<string>,
    mapResult: (result: unknown) => Promise<unknown>,
  ): Promise<AsyncWorkspaceOperation> {
    const id = operationId(input);
    const existing = this.#operations.get(id);
    if (existing !== undefined) return existing;
    const operation = this.#cli
      .runJson(command, { mutation: true })
      .then(mapResult)
      .then(
        (result): AsyncWorkspaceOperation => ({
          operationId: id,
          status: "completed",
          workspaceId,
          result,
        }),
        (cause: unknown): AsyncWorkspaceOperation => ({
          operationId: id,
          status: "failed",
          workspaceId,
          message: cause instanceof Error ? cause.message : "Lotus Runtime operation failed.",
        }),
      );
    this.#operations.set(id, operation);
    return operation;
  }
}
