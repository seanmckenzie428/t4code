#!/usr/bin/env node

import * as NodeReadline from "node:readline";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
//#region src/lotusCli.ts
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
var LotusCliError = class extends Error {
	kind;
	argv;
	constructor(input) {
		super(input.message, { cause: input.cause });
		this.name = "LotusCliError";
		this.kind = input.kind;
		this.argv = input.argv;
	}
};
const nodeLotusRunner = { run: async (executable, args, options = {}) => {
	try {
		const result = await execFile(executable, [...args], {
			shell: false,
			windowsHide: true,
			encoding: "utf8",
			maxBuffer: MAX_JSON_BYTES,
			timeout: options.timeoutMs,
			signal: options.signal
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr
		};
	} catch (cause) {
		const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : void 0;
		throw new LotusCliError({
			kind: code === "ENOENT" ? "unavailable" : "command-failed",
			message: code === "ENOENT" ? "Lotus Runtime CLI is not installed or is not available on PATH." : "Lotus Runtime command failed.",
			argv: [executable, ...args],
			cause
		});
	}
} };
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const parseBoundedJson = (stdout, argv) => {
	if (Buffer.byteLength(stdout, "utf8") > 2097152) throw new LotusCliError({
		kind: "oversized-output",
		message: "Lotus Runtime JSON exceeded the 2 MiB extension limit.",
		argv
	});
	try {
		return JSON.parse(stdout);
	} catch (cause) {
		throw new LotusCliError({
			kind: "malformed-output",
			message: "Lotus Runtime returned malformed JSON.",
			argv,
			cause
		});
	}
};
var LotusCli = class {
	#runner;
	#executable;
	constructor(input = {}) {
		this.#runner = input.runner ?? nodeLotusRunner;
		this.#executable = input.executable ?? "lotus";
	}
	runJson(args, options = {}) {
		const jsonArgs = args.includes("--json") ? [...args] : [...args, "--json"];
		const argv = [this.#executable, ...jsonArgs];
		return this.#runner.run(this.#executable, jsonArgs, {
			...options.signal === void 0 ? {} : { signal: options.signal },
			timeoutMs: options.timeoutMs ?? (options.mutation === true ? 18e5 : 3e4)
		}).then(({ stdout }) => parseBoundedJson(stdout, argv));
	}
};
//#endregion
//#region src/provider.ts
const stringValue = (record, ...keys) => {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") return value;
	}
};
const recordValue = (record, key) => {
	const value = record[key];
	return isRecord(value) ? value : void 0;
};
const arrayValue = (record, key) => {
	const value = record[key];
	return Array.isArray(value) ? value : [];
};
const workspaceRows = (value) => {
	if (Array.isArray(value)) return value;
	if (!isRecord(value)) throw new Error("Lotus Runtime list result is not an object or array.");
	for (const key of [
		"workspaces",
		"stacks",
		"items"
	]) {
		const rows = value[key];
		if (Array.isArray(rows)) return rows;
	}
	if (isRecord(value.workspace)) return [value.workspace];
	throw new Error("Lotus Runtime list result does not contain workspaces.");
};
const normalizeUrls = (row) => {
	const source = recordValue(row, "urls") ?? {};
	const urls = {};
	for (const [target, aliases] of Object.entries({
		admin: ["admin", "admin_url"],
		api: ["api", "api_url"],
		dashboard: ["dashboard", "dashboard_url"],
		storefront: [
			"storefront",
			"store",
			"storefront_url",
			"store_url"
		],
		mail: ["mail", "mail_url"]
	})) {
		const value = stringValue(source, ...aliases) ?? stringValue(row, ...aliases);
		if (value !== void 0) urls[target] = value;
	}
	return urls;
};
const toWorkspaceDescriptor = (value) => {
	if (!isRecord(value)) throw new Error("Lotus Runtime workspace is not an object.");
	const id = stringValue(value, "slug", "workspace_id", "id");
	if (id === void 0) throw new Error("Lotus Runtime workspace is missing its slug.");
	const root = stringValue(value, "worktree_path", "root", "path");
	const status = stringValue(value, "status", "state");
	const branch = stringValue(value, "branch", "branch_name");
	const metadata = {
		providerId: "lotus",
		workspaceBinding: {
			extensionId: "lotus-runtime",
			providerId: "lotus",
			workspaceId: id
		},
		...branch === void 0 ? {} : { branch },
		health: value.health ?? null,
		checks: arrayValue(value, "checks"),
		commands: arrayValue(value, "commands"),
		urls: normalizeUrls(value),
		drift: value.drift ?? null,
		warnings: arrayValue(value, "warnings"),
		adoptable: true,
		skipNativeBootstrap: true
	};
	return {
		id,
		title: stringValue(value, "title", "name") ?? id,
		...root === void 0 ? {} : { root },
		...status === void 0 ? {} : { status },
		metadata
	};
};
const objectSchema$1 = (properties = {}, required = []) => ({
	type: "object",
	additionalProperties: false,
	properties,
	required
});
const actions = [
	{
		id: "explain",
		title: "Explain workspace",
		risk: "observe",
		inputSchema: objectSchema$1()
	},
	{
		id: "todo-list",
		title: "List todos",
		risk: "observe",
		inputSchema: objectSchema$1()
	},
	{
		id: "resume",
		title: "Resume stack",
		risk: "mutate",
		inputSchema: objectSchema$1()
	},
	{
		id: "down",
		title: "Stop stack",
		risk: "mutate",
		inputSchema: objectSchema$1()
	},
	{
		id: "recreate",
		title: "Recreate services",
		risk: "mutate",
		inputSchema: objectSchema$1({
			services: {
				type: "array",
				items: { type: "string" },
				maxItems: 32
			},
			build: { type: "boolean" }
		})
	},
	{
		id: "fresh-db",
		title: "Fresh database",
		description: "Destroys and reseeds the workspace database. Confirmation cannot be remembered.",
		risk: "destructive",
		inputSchema: objectSchema$1()
	},
	{
		id: "clone-db-replace",
		title: "Replace database clone",
		description: "Replaces the active database with an anonymized runtime clone.",
		risk: "destructive",
		inputSchema: objectSchema$1({ source: {
			type: "string",
			minLength: 1
		} }, ["source"])
	},
	{
		id: "trash",
		title: "Trash workspace",
		description: "Removes the runtime stack and normally its worktree.",
		risk: "destructive",
		inputSchema: objectSchema$1({
			force: { type: "boolean" },
			keepWorktree: { type: "boolean" }
		})
	},
	{
		id: "logs",
		title: "Open logs in terminal",
		risk: "external",
		inputSchema: objectSchema$1({
			services: {
				type: "array",
				items: { type: "string" },
				maxItems: 32
			},
			follow: { type: "boolean" }
		})
	},
	...[
		"admin",
		"api",
		"dashboard",
		"storefront",
		"mail"
	].map((target) => ({
		id: `open-${target}`,
		title: `Open ${target}`,
		risk: "external",
		inputSchema: objectSchema$1()
	}))
];
const argsRecord = (value) => isRecord(value) ? value : {};
const stringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const safeSegment = (value, label) => {
	if (value === "" || value.startsWith("-") || value.includes("\0")) throw new Error(`${label} is invalid.`);
	return value;
};
const operationId = (input) => typeof input.operationId === "string" && input.operationId.trim() !== "" ? input.operationId : NodeCrypto.randomUUID();
var LotusWorkspaceProvider = class {
	providerId = "lotus";
	#cli;
	#operations = /* @__PURE__ */ new Map();
	constructor(cli = new LotusCli()) {
		this.#cli = cli;
	}
	async status(slug) {
		return this.#cli.runJson(slug === void 0 ? ["status"] : ["status", safeSegment(slug, "slug")]);
	}
	async list() {
		const result = await this.#cli.runJson(["list"]);
		return workspaceRows(result).map(toWorkspaceDescriptor);
	}
	async explain(slug) {
		return this.#cli.runJson(["explain", safeSegment(slug, "slug")]);
	}
	async todoList(slug) {
		return this.#cli.runJson([
			"todo",
			"list",
			safeSegment(slug, "slug")
		]);
	}
	async detect(projectRoot) {
		const normalizedRoot = NodePath.resolve(projectRoot);
		const workspace = (await this.list()).find((candidate) => candidate.root !== void 0 && NodePath.resolve(candidate.root) === normalizedRoot);
		return workspace === void 0 ? {
			detected: false,
			confidence: 0,
			reason: "No Lotus workspace owns this project root."
		} : {
			detected: true,
			confidence: 1,
			workspaceId: workspace.id,
			reason: "Project root matches the Lotus Runtime worktree path."
		};
	}
	async describe(workspaceId) {
		const slug = safeSegment(workspaceId, "workspaceId");
		const raw = await this.explain(slug);
		let row = raw;
		if (isRecord(raw)) row = raw.workspace ?? raw.stack ?? raw;
		const workspace = toWorkspaceDescriptor(row);
		return {
			workspace,
			actions: actions.map((action) => action.id),
			detail: {
				cockpit: workspace.metadata,
				raw
			}
		};
	}
	async create(input) {
		const args = argsRecord(input);
		const slugValue = typeof args.slug === "string" ? safeSegment(args.slug, "slug") : void 0;
		if (slugValue === void 0) throw new Error("slug is required.");
		const command = ["create", slugValue];
		if (typeof args.branch === "string") command.push("--branch", safeSegment(args.branch, "branch"));
		return this.#runOperation(args, slugValue, command, async (result) => ({
			runtime: result,
			workspaceBinding: {
				extensionId: "lotus-runtime",
				providerId: "lotus",
				workspaceId: slugValue
			},
			adoptable: true,
			skipNativeBootstrap: true,
			ownership: "lotus-runtime"
		}));
	}
	listActions() {
		return actions;
	}
	async invoke(workspaceId, actionId, input) {
		const slug = safeSegment(workspaceId, "workspaceId");
		const args = argsRecord(input);
		if (actionId === "explain") return this.#completed(args, slug, await this.explain(slug));
		if (actionId === "todo-list") return this.#completed(args, slug, await this.todoList(slug));
		if (actionId === "logs") {
			const command = [
				"lotus",
				"logs",
				slug,
				...stringArray(args.services).map((service) => safeSegment(service, "service"))
			];
			if (args.follow === true) command.push("--follow");
			return this.#completed(args, slug, { handoff: {
				kind: "visible-terminal",
				argv: command
			} });
		}
		if (actionId.startsWith("open-")) {
			const target = actionId.slice(5);
			const detail = await this.describe(slug);
			const cockpit = isRecord(detail.detail) && isRecord(detail.detail.cockpit) ? detail.detail.cockpit : {};
			const url = (isRecord(cockpit.urls) ? cockpit.urls : {})[target];
			if (typeof url !== "string") throw new Error(`Lotus Runtime did not report a ${target} URL.`);
			return this.#completed(args, slug, { handoff: {
				kind: target === "dashboard" ? "preview" : "open-url",
				url
			} });
		}
		const command = this.#mutationCommand(slug, actionId, args);
		return this.#runOperation(args, slug, command, async (result) => ({
			runtime: result,
			ownership: "lotus-runtime"
		}));
	}
	getOperation(id) {
		return this.#operations.get(id);
	}
	#mutationCommand(slug, actionId, args) {
		switch (actionId) {
			case "resume": return ["resume", slug];
			case "down": return ["down", slug];
			case "recreate": {
				const command = [
					"recreate",
					slug,
					...stringArray(args.services).map((service) => safeSegment(service, "service"))
				];
				if (args.build === true) command.push("--build");
				return command;
			}
			case "fresh-db": return ["fresh-db", slug];
			case "clone-db-replace":
				if (typeof args.source !== "string") throw new Error("source is required.");
				return [
					"clone-db",
					slug,
					"--source",
					safeSegment(args.source, "source"),
					"--replace"
				];
			case "trash": {
				const command = ["trash", slug];
				if (args.force === true) command.push("--force");
				if (args.keepWorktree === true) command.push("--keep-worktree");
				return command;
			}
			default: throw new Error(`Unknown Lotus workspace action: ${actionId}`);
		}
	}
	#completed(input, workspaceId, result) {
		return {
			operationId: operationId(input),
			status: "completed",
			workspaceId,
			result
		};
	}
	#runOperation(input, workspaceId, command, mapResult) {
		const id = operationId(input);
		const existing = this.#operations.get(id);
		if (existing !== void 0) return existing;
		const operation = this.#cli.runJson(command, { mutation: true }).then(mapResult).then((result) => ({
			operationId: id,
			status: "completed",
			workspaceId,
			result
		}), (cause) => ({
			operationId: id,
			status: "failed",
			workspaceId,
			message: cause instanceof Error ? cause.message : "Lotus Runtime operation failed."
		}));
		this.#operations.set(id, operation);
		return operation;
	}
};
//#endregion
//#region src/mcpServer.ts
const MAX_REQUEST_BYTES = 1024 * 1024;
const PROVIDER_METADATA_KEY = "t3.workspace-provider/v1";
const objectSchema = (properties = {}, required = []) => ({
	type: "object",
	additionalProperties: false,
	properties,
	required
});
const workspaceIdSchema = objectSchema({ workspaceId: {
	type: "string",
	minLength: 1
} }, ["workspaceId"]);
const providerTool = (name, description, operation, inputSchema) => ({
	name,
	description,
	inputSchema,
	_meta: { [PROVIDER_METADATA_KEY]: {
		providerId: "lotus",
		operation
	} }
});
const tools = [
	{
		name: "lotus_status",
		description: "Read Lotus Runtime status without mutating it.",
		inputSchema: objectSchema({ slug: {
			type: "string",
			minLength: 1
		} })
	},
	{
		name: "lotus_list",
		description: "List observed Lotus Runtime workspaces.",
		inputSchema: objectSchema()
	},
	{
		name: "lotus_explain",
		description: "Read a Lotus Runtime workspace inventory and drift report.",
		inputSchema: objectSchema({ slug: {
			type: "string",
			minLength: 1
		} }, ["slug"])
	},
	{
		name: "lotus_todo_list",
		description: "List persisted Lotus Runtime todos for a workspace.",
		inputSchema: objectSchema({ slug: {
			type: "string",
			minLength: 1
		} }, ["slug"])
	},
	providerTool("lotus_workspace_detect", "Detect whether a project root belongs to a Lotus Runtime workspace.", "detect", objectSchema({ projectRoot: {
		type: "string",
		minLength: 1
	} }, ["projectRoot"])),
	providerTool("lotus_workspace_list", "List Lotus Runtime workspaces for adoption and refresh.", "list", objectSchema()),
	providerTool("lotus_workspace_describe", "Describe a Lotus Runtime workspace and its cockpit actions.", "describe", workspaceIdSchema),
	providerTool("lotus_workspace_create", "Create a Lotus Runtime workspace; the runtime remains lifecycle owner.", "create", objectSchema({
		slug: {
			type: "string",
			minLength: 1
		},
		branch: {
			type: "string",
			minLength: 1
		},
		operationId: {
			type: "string",
			minLength: 1
		}
	}, ["slug"])),
	providerTool("lotus_workspace_list_actions", "List available Lotus Runtime workspace actions and risk tiers.", "list-actions", workspaceIdSchema),
	providerTool("lotus_workspace_invoke", "Invoke an authorized Lotus Runtime workspace action.", "invoke", objectSchema({
		workspaceId: {
			type: "string",
			minLength: 1
		},
		actionId: {
			type: "string",
			minLength: 1
		},
		args: { type: "object" }
	}, ["workspaceId", "actionId"])),
	{
		name: "lotus_operation_get",
		description: "Read a previously issued idempotent Lotus operation receipt.",
		inputSchema: objectSchema({ operationId: {
			type: "string",
			minLength: 1
		} }, ["operationId"])
	}
];
const requiredString = (input, key) => {
	const value = input[key];
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required.`);
	return value;
};
var LotusMcpServer = class {
	#provider;
	constructor(provider = new LotusWorkspaceProvider()) {
		this.#provider = provider;
	}
	async callTool(name, inputValue) {
		const input = isRecord(inputValue) ? inputValue : {};
		switch (name) {
			case "lotus_status": return this.#provider.status(typeof input.slug === "string" ? input.slug : void 0);
			case "lotus_list":
			case "lotus_workspace_list": return this.#provider.list();
			case "lotus_explain": return this.#provider.explain(requiredString(input, "slug"));
			case "lotus_todo_list": return this.#provider.todoList(requiredString(input, "slug"));
			case "lotus_workspace_detect": return this.#provider.detect(requiredString(input, "projectRoot"));
			case "lotus_workspace_describe": return this.#provider.describe(requiredString(input, "workspaceId"));
			case "lotus_workspace_create": return this.#provider.create(input);
			case "lotus_workspace_list_actions": return this.#provider.listActions();
			case "lotus_workspace_invoke": return this.#provider.invoke(requiredString(input, "workspaceId"), requiredString(input, "actionId"), input.args);
			case "lotus_operation_get": {
				const receipt = this.#provider.getOperation(requiredString(input, "operationId"));
				if (receipt === void 0) throw new Error("Lotus operation receipt was not found.");
				return receipt;
			}
			default: throw new Error(`Unknown tool: ${name}`);
		}
	}
	async handle(message) {
		if (!isRecord(message) || message.jsonrpc !== "2.0") return void 0;
		if (message.method === "notifications/initialized") return void 0;
		const id = message.id;
		if (typeof id !== "string" && typeof id !== "number") return void 0;
		try {
			switch (message.method) {
				case "initialize": return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2025-06-18",
						capabilities: { tools: {} },
						serverInfo: {
							name: "t3-lotus-runtime",
							version: "0.1.0"
						}
					}
				};
				case "tools/list": return {
					jsonrpc: "2.0",
					id,
					result: { tools }
				};
				case "tools/call": {
					if (!isRecord(message.params)) throw new Error("tools/call params are invalid.");
					const name = requiredString(message.params, "name");
					const result = await this.callTool(name, message.params.arguments);
					return {
						jsonrpc: "2.0",
						id,
						result: {
							content: [{
								type: "text",
								text: JSON.stringify(result)
							}],
							structuredContent: result
						}
					};
				}
				default: return {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32601,
						message: "Method not found."
					}
				};
			}
		} catch (cause) {
			return {
				jsonrpc: "2.0",
				id,
				error: {
					code: -32e3,
					message: cause instanceof Error ? cause.message : "Lotus Runtime extension failed."
				}
			};
		}
	}
};
const serveStdio = (server = new LotusMcpServer(), input = process.stdin, output = process.stdout) => {
	NodeReadline.createInterface({ input }).on("line", (line) => {
		if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) {
			output.write(`${JSON.stringify({
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32600,
					message: "Request exceeds 1 MiB."
				}
			})}\n`);
			return;
		}
		let request;
		try {
			request = JSON.parse(line);
		} catch {
			output.write(`${JSON.stringify({
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32700,
					message: "Parse error."
				}
			})}\n`);
			return;
		}
		server.handle(request).then((response) => {
			if (response !== void 0) output.write(`${JSON.stringify(response)}\n`);
		});
	});
};
//#endregion
//#region src/server.ts
serveStdio();
//#endregion
export {};

//# sourceMappingURL=server.mjs.map