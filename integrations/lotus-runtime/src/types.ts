export type JsonRecord = Record<string, unknown>;

export interface LotusCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface LotusCommandOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface LotusRunner {
  readonly run: (
    executable: string,
    args: ReadonlyArray<string>,
    options?: LotusCommandOptions,
  ) => Promise<LotusCommandResult>;
}

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly title: string;
  readonly root?: string;
  readonly status?: string;
  readonly metadata?: JsonRecord;
}

export interface WorkspaceAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly risk: "observe" | "mutate" | "external" | "destructive";
  readonly inputSchema: JsonRecord;
}

export interface AsyncWorkspaceOperation {
  readonly operationId: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly workspaceId?: string;
  readonly message?: string;
  readonly result?: unknown;
}
