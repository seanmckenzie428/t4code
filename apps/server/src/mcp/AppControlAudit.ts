import {
  CommandId,
  EventId,
  type AppCommandDescriptor,
  type AppCommandInvocation,
  type AppControlPrincipal,
  type AppControlRisk,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as McpInvocationContext from "./McpInvocationContext.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

export type AppControlAuditStatus = "requested" | "completed" | "failed" | "declined";

type Scope = McpInvocationContext.McpInvocationScope & {
  readonly principal: NonNullable<McpInvocationContext.McpInvocationScope["principal"]>;
};

export interface AppControlAuditInput {
  readonly scope: Scope;
  readonly invocation: AppCommandInvocation;
  readonly descriptor: AppCommandDescriptor | undefined;
  readonly status: AppControlAuditStatus;
}

export interface AppControlAuditPayload {
  readonly actionId: string;
  readonly commandId: string;
  readonly principalKind: AppControlPrincipal["kind"];
  readonly risk: AppControlRisk;
  readonly status: AppControlAuditStatus;
  readonly projectId?: string;
  readonly threadId?: string;
  readonly assistantThreadId?: string;
}

export class AppControlAudit extends Context.Service<
  AppControlAudit,
  { readonly record: (input: AppControlAuditInput) => Effect.Effect<void> }
>()("t3/mcp/AppControlAudit") {}

export const payloadFor = (input: AppControlAuditInput): AppControlAuditPayload => ({
  actionId: input.invocation.actionId,
  commandId: input.invocation.commandId,
  principalKind: input.scope.principal.kind,
  risk: input.descriptor?.risk ?? "forbidden",
  status: input.status,
  ...(input.scope.principal.kind === "thread-agent"
    ? {
        projectId: input.scope.principal.projectId,
        threadId: input.scope.principal.threadId,
      }
    : { assistantThreadId: input.scope.principal.assistantThreadId }),
});

const auditThreadId = (principal: AppControlPrincipal): ThreadId =>
  principal.kind === "thread-agent" ? principal.threadId : principal.assistantThreadId;

const summaryFor = (input: AppControlAuditInput): string => {
  const title = input.descriptor?.title ?? "App command";
  switch (input.status) {
    case "requested":
      return `${title} requested`;
    case "completed":
      return `${title} completed`;
    case "declined":
      return `${title} declined`;
    case "failed":
      return `${title} failed`;
  }
};

export const make = Effect.gen(function* AppControlAuditMake() {
  const engine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;

  const record: AppControlAudit["Service"]["record"] = Effect.fn("AppControlAudit.record")(
    function* (input) {
      const payload = payloadFor(input);
      yield* Effect.logInfo(`app-control.${input.status}`, payload);

      const threadId = auditThreadId(input.scope.principal);
      const thread = yield* projections.getThreadShellById(threadId);
      if (Option.isNone(thread)) {
        yield* Effect.logWarning("Skipped persisted app-control audit without a valid thread", {
          actionId: input.invocation.actionId,
          commandId: input.invocation.commandId,
          principalKind: input.scope.principal.kind,
          status: input.status,
        });
        return;
      }

      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const auditKey = `${input.scope.providerSessionId}:${input.invocation.actionId}:${input.status}`;
      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`app-control-audit:${auditKey}`),
        threadId,
        activity: {
          id: EventId.make(`app-control-audit:${auditKey}`),
          tone: input.status === "failed" ? "error" : "info",
          kind: `app-control.${input.status}`,
          summary: summaryFor(input),
          payload,
          turnId: null,
          createdAt,
        },
        createdAt,
      });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to persist app-control audit activity", {
        cause,
      }),
    ),
  );

  return AppControlAudit.of({ record });
});

export const layer = Layer.effect(AppControlAudit, make);
