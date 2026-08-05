import { expect, it } from "@effect/vitest";
import {
  AppActionId,
  AppCommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as NodeCrypto from "node:crypto";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as AppControlBroker from "./AppControlBroker.ts";
import { AppControlAudit } from "./AppControlAudit.ts";
import {
  APP_CONTROL_COMPLETED_ACTION_LIMIT,
  evaluateAppControlAccess,
  make,
} from "./AppControlPolicy.ts";
import * as AppControlServerExecutor from "./AppControlServerExecutor.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const scope = (grants: ReadonlyArray<string> = []) => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  principal: {
    kind: "thread-agent" as const,
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
  },
  capabilities: new Set(["app-control"] as const),
  grants: new Set(grants),
  issuedAt: 1,
});

const invocation = (commandId: string, args: unknown = {}) => ({
  actionId: AppActionId.make(`action:${commandId}`),
  commandId: AppCommandId.make(commandId),
  args,
});

it("allows observation/navigation without a grant", () => {
  expect(
    evaluateAppControlAccess({ scope: scope(), invocation: invocation("ui.diff.open") }),
  ).toEqual({
    status: "allow",
  });
});

it("requires the exact scoped grant for reversible mutations", () => {
  expect(
    evaluateAppControlAccess({
      scope: scope(),
      invocation: invocation("thread.rename", { threadId: "thread-1", title: "Renamed" }),
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
  expect(
    evaluateAppControlAccess({
      scope: scope(["thread:mutate"]),
      invocation: invocation("thread.rename", { threadId: "thread-1", title: "Renamed" }),
    }),
  ).toEqual({ status: "allow" });
});

it("rejects cross-thread and cross-project targets", () => {
  expect(
    evaluateAppControlAccess({
      scope: scope(["thread:mutate"]),
      invocation: invocation("thread.rename", { threadId: "thread-2", title: "No" }),
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
  expect(
    evaluateAppControlAccess({
      scope: scope(["project:mutate"]),
      invocation: invocation("project.rename", { projectId: "project-2", title: "No" }),
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
});

it("always confirms destructive and raw/external calls", () => {
  expect(
    evaluateAppControlAccess({
      scope: scope(["thread:mutate", "project:mutate"]),
      invocation: invocation("thread.delete", { threadId: "thread-1" }),
    }),
  ).toEqual({ status: "confirm" });
  expect(
    evaluateAppControlAccess({
      scope: scope(),
      invocation: invocation("terminal.command.run", { command: "pwd" }),
    }),
  ).toEqual({ status: "confirm" });
  expect(
    evaluateAppControlAccess({
      scope: scope(),
      invocation: invocation("ui.external-url.open", { url: "https://example.com" }),
    }),
  ).toEqual({ status: "confirm" });
});

it.effect("shows the exact terminal command in the per-call confirmation", () =>
  Effect.gen(function* () {
    let targetName: string | undefined;
    const broker = AppControlBroker.AppControlBroker.of({
      connect: () => Effect.succeed(Stream.empty),
      focusHost: () => Effect.void,
      respond: () => Effect.void,
      cancelProviderSession: () => Effect.void,
      cancelThread: () => Effect.void,
      cancelAll: Effect.void,
      invoke: (input) =>
        Effect.sync(() => {
          targetName = input.confirmation?.targetName;
          return { decision: "allow" };
        }),
    } as AppControlBroker.AppControlBroker["Service"]);
    const executor = AppControlServerExecutor.AppControlServerExecutor.of({
      execute: (input) =>
        Effect.succeed({
          status: "declined" as const,
          actionId: input.invocation.actionId,
        }),
    });
    const policy = yield* make.pipe(
      Effect.provideService(AppControlBroker.AppControlBroker, broker),
      Effect.provideService(AppControlAudit, AppControlAudit.of({ record: () => Effect.void })),
      Effect.provideService(AppControlServerExecutor.AppControlServerExecutor, executor),
      Effect.provideService(ProjectionSnapshotQuery, {} as ProjectionSnapshotQuery["Service"]),
    );

    yield* policy.invoke({
      scope: scope(),
      invocation: invocation("terminal.command.run", { command: "lotus tableplus dev" }),
    });
    expect(targetName).toBe("lotus tableplus dev");
  }),
);

it.effect("names the proposed project action and URL in its confirmation", () =>
  Effect.gen(function* () {
    let targetName: string | undefined;
    const broker = AppControlBroker.AppControlBroker.of({
      connect: () => Effect.succeed(Stream.empty),
      focusHost: () => Effect.void,
      respond: () => Effect.void,
      cancelProviderSession: () => Effect.void,
      cancelThread: () => Effect.void,
      cancelAll: Effect.void,
      invoke: (input) =>
        Effect.sync(() => {
          targetName = input.confirmation?.targetName;
          return { decision: "allow" };
        }),
    } as AppControlBroker.AppControlBroker["Service"]);
    const executor = AppControlServerExecutor.AppControlServerExecutor.of({
      execute: (input) =>
        Effect.succeed({ status: "declined" as const, actionId: input.invocation.actionId }),
    });
    const policy = yield* make.pipe(
      Effect.provideService(AppControlBroker.AppControlBroker, broker),
      Effect.provideService(AppControlAudit, AppControlAudit.of({ record: () => Effect.void })),
      Effect.provideService(AppControlServerExecutor.AppControlServerExecutor, executor),
      Effect.provideService(ProjectionSnapshotQuery, {} as ProjectionSnapshotQuery["Service"]),
    );
    yield* policy.invoke({
      scope: scope(),
      invocation: invocation("project.action.upsert", {
        projectId: "project-1",
        action: {
          id: "lotus-admin",
          name: "Admin",
          commandId: "ui.external-url.open",
          url: "https://dev.admin.lotus.localhost",
        },
      }),
    });
    expect(targetName).toBe("Admin: https://dev.admin.lotus.localhost");
  }),
);

it("binds imported-script grants to script ID and command hash", () => {
  const command = invocation("script.run", { scriptId: "dev", commandHash: "hash-2" });
  expect(
    evaluateAppControlAccess({ scope: scope(["script:dev:hash-1"]), invocation: command }),
  ).toEqual({
    status: "confirm",
  });
  expect(
    evaluateAppControlAccess({ scope: scope(["script:dev:hash-2"]), invocation: command }),
  ).toEqual({
    status: "allow",
  });
});

it("confirms terminal-action imports and keeps them in the current project", () => {
  const command = invocation("script.import", {
    projectId: "project-1",
    script: {
      id: "lotus-tableplus-dev",
      name: "TablePlus",
      command: "lotus tableplus dev",
    },
  });
  expect(evaluateAppControlAccess({ scope: scope(), invocation: command })).toEqual({
    status: "confirm",
  });
  expect(
    evaluateAppControlAccess({
      scope: scope(),
      invocation: {
        ...command,
        args: {
          projectId: "project-2",
          script: {
            id: "lotus-tableplus-dev",
            name: "TablePlus",
            command: "lotus tableplus dev",
          },
        },
      },
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
  expect(
    evaluateAppControlAccess({
      scope: {
        ...scope(),
        principal: {
          kind: "global-assistant" as const,
          assistantThreadId: ThreadId.make("assistant-1"),
        },
      },
      invocation: command,
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
});

it.effect(
  "validates imported scripts server-side before routing to the visible client terminal",
  () =>
    Effect.gen(function* () {
      const command = "pnpm dev";
      const commandHash = NodeCrypto.createHash("sha256").update(command).digest("hex");
      let projectedThreadProjectId = "project-1";
      let confirmationCount = 0;
      const routed: Array<{ commandId: string; args: unknown }> = [];
      const broker = AppControlBroker.AppControlBroker.of({
        connect: () => Effect.succeed(Stream.empty),
        focusHost: () => Effect.void,
        respond: () => Effect.void,
        cancelProviderSession: () => Effect.void,
        cancelThread: () => Effect.void,
        cancelAll: Effect.void,
        invoke: (input) => {
          if (input.confirmation !== undefined) {
            confirmationCount += 1;
            return Effect.succeed({ decision: "allow" });
          }
          return Effect.sync(() => {
            routed.push({ commandId: input.invocation.commandId, args: input.invocation.args });
            return {
              status: "completed" as const,
              receipt: {
                receiptId: `client:${input.invocation.actionId}`,
                actionId: input.invocation.actionId,
                commandId: input.invocation.commandId,
                completedAt: "2026-01-01T00:00:00.000Z",
                idempotentReplay: false,
              },
              result: null,
            };
          });
        },
      } as AppControlBroker.AppControlBroker["Service"]);
      const projections = ProjectionSnapshotQuery.of({
        getThreadShellById: () =>
          Effect.succeed(
            Option.some({ id: "thread-1", projectId: projectedThreadProjectId } as never),
          ),
        getProjectShellById: () =>
          Effect.succeed(
            Option.some({
              id: "project-1",
              kind: "workspace",
              scripts: [
                {
                  id: "dev",
                  name: "Dev",
                  command,
                  icon: "play",
                  runOnWorktreeCreate: false,
                },
              ],
            } as never),
          ),
      } as never);
      const policy = yield* make.pipe(
        Effect.provideService(AppControlBroker.AppControlBroker, broker),
        Effect.provideService(AppControlAudit, AppControlAudit.of({ record: () => Effect.void })),
        Effect.provideService(
          AppControlServerExecutor.AppControlServerExecutor,
          AppControlServerExecutor.AppControlServerExecutor.of({
            execute: () => Effect.die("Client-owned script must not reach server executor."),
          }),
        ),
        Effect.provideService(ProjectionSnapshotQuery, projections),
      );

      const valid = yield* policy.invoke({
        scope: scope(),
        invocation: invocation("script.run", { scriptId: "dev" }),
      });
      expect(valid).toMatchObject({ status: "completed" });
      expect(routed).toEqual([{ commandId: "script.run", args: { scriptId: "dev", commandHash } }]);
      const granted = yield* policy.invoke({
        scope: scope([`script:dev:${commandHash}`]),
        invocation: {
          ...invocation("script.run", { scriptId: "dev" }),
          actionId: AppActionId.make("action:script-granted"),
        },
      });
      expect(granted).toMatchObject({ status: "completed" });
      expect(confirmationCount).toBe(1);

      const drifted = yield* policy.invoke({
        scope: scope(),
        invocation: {
          ...invocation("script.run", { scriptId: "dev", commandHash: "stale" }),
          actionId: AppActionId.make("action:script-drifted"),
        },
      });
      const unknown = yield* policy.invoke({
        scope: scope(),
        invocation: {
          ...invocation("script.run", { scriptId: "missing" }),
          actionId: AppActionId.make("action:script-missing"),
        },
      });
      projectedThreadProjectId = "project-2";
      const crossProject = yield* policy.invoke({
        scope: scope(),
        invocation: {
          ...invocation("script.run", { scriptId: "dev" }),
          actionId: AppActionId.make("action:script-cross-project"),
        },
      });
      expect(drifted).toMatchObject({ status: "failed", error: { code: "conflict" } });
      expect(unknown).toMatchObject({ status: "failed", error: { code: "invalid-input" } });
      expect(crossProject).toMatchObject({ status: "failed", error: { code: "forbidden" } });
      expect(routed).toHaveLength(2);
    }),
);

it("rejects global-assistant script execution before confirmation", () => {
  expect(
    evaluateAppControlAccess({
      scope: {
        ...scope(),
        principal: {
          kind: "global-assistant" as const,
          assistantThreadId: ThreadId.make("assistant-1"),
        },
      },
      invocation: invocation("script.run", { scriptId: "dev" }),
    }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
});

it("never exposes approval or user-input responses", () => {
  expect(
    evaluateAppControlAccess({ scope: scope(), invocation: invocation("approval.respond") }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
  expect(
    evaluateAppControlAccess({ scope: scope(), invocation: invocation("user-input.respond") }),
  ).toMatchObject({ status: "deny", error: { code: "forbidden" } });
});

it.effect("coalesces concurrent calls with the same action ID", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let executionCount = 0;
    const executor = AppControlServerExecutor.AppControlServerExecutor.of({
      execute: (input) =>
        Effect.gen(function* () {
          executionCount += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return {
            status: "completed" as const,
            receipt: {
              receiptId: "receipt-1",
              actionId: input.invocation.actionId,
              commandId: input.invocation.commandId,
              sequence: 1,
              revision: 1,
              completedAt: "2026-01-01T00:00:00.000Z",
              idempotentReplay: false,
            },
            result: { renamed: true },
          };
        }),
    });
    const broker = AppControlBroker.AppControlBroker.of({
      connect: () => Effect.succeed(Stream.empty),
      focusHost: () => Effect.void,
      respond: () => Effect.void,
      cancelProviderSession: () => Effect.void,
      cancelThread: () => Effect.void,
      cancelAll: Effect.void,
      invoke: () =>
        Effect.fail({
          code: "unavailable" as const,
          message: "unused",
          retryable: false,
        }),
    } as AppControlBroker.AppControlBroker["Service"]);
    const policy = yield* make.pipe(
      Effect.provideService(AppControlBroker.AppControlBroker, broker),
      Effect.provideService(AppControlAudit, AppControlAudit.of({ record: () => Effect.void })),
      Effect.provideService(AppControlServerExecutor.AppControlServerExecutor, executor),
      Effect.provideService(ProjectionSnapshotQuery, {} as ProjectionSnapshotQuery["Service"]),
    );
    const input = {
      scope: scope(["thread:mutate"]),
      invocation: invocation("thread.rename", { threadId: "thread-1", title: "Renamed" }),
    };
    const first = yield* policy.invoke(input).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const second = yield* policy.invoke(input).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    expect(executionCount).toBe(1);
    yield* Deferred.succeed(release, undefined);

    expect(yield* Fiber.join(first)).toEqual(yield* Fiber.join(second));
    expect(executionCount).toBe(1);
  }),
);

it.effect("bounds completed idempotency receipts without evicting active work", () =>
  Effect.gen(function* () {
    let executionCount = 0;
    const executor = AppControlServerExecutor.AppControlServerExecutor.of({
      execute: (input) =>
        Effect.sync(() => {
          executionCount += 1;
          return {
            status: "completed" as const,
            receipt: {
              receiptId: `receipt-${executionCount}`,
              actionId: input.invocation.actionId,
              commandId: input.invocation.commandId,
              completedAt: "2026-01-01T00:00:00.000Z",
              idempotentReplay: false,
            },
            result: { renamed: true },
          };
        }),
    });
    const broker = AppControlBroker.AppControlBroker.of({
      connect: () => Effect.succeed(Stream.empty),
      focusHost: () => Effect.void,
      respond: () => Effect.void,
      cancelProviderSession: () => Effect.void,
      cancelThread: () => Effect.void,
      cancelAll: Effect.void,
      invoke: () =>
        Effect.fail({
          code: "unavailable" as const,
          message: "unused",
          retryable: false,
        }),
    } as AppControlBroker.AppControlBroker["Service"]);
    const policy = yield* make.pipe(
      Effect.provideService(AppControlBroker.AppControlBroker, broker),
      Effect.provideService(AppControlAudit, AppControlAudit.of({ record: () => Effect.void })),
      Effect.provideService(AppControlServerExecutor.AppControlServerExecutor, executor),
      Effect.provideService(ProjectionSnapshotQuery, {} as ProjectionSnapshotQuery["Service"]),
    );
    const makeInput = (index: number) => ({
      scope: scope(["thread:mutate"]),
      invocation: {
        ...invocation("thread.rename", { threadId: "thread-1", title: `Title ${index}` }),
        actionId: AppActionId.make(`action:rename:${index}`),
      },
    });

    for (let index = 0; index <= APP_CONTROL_COMPLETED_ACTION_LIMIT; index += 1) {
      yield* policy.invoke(makeInput(index));
    }
    expect(executionCount).toBe(APP_CONTROL_COMPLETED_ACTION_LIMIT + 1);

    yield* policy.invoke(makeInput(0));
    expect(executionCount).toBe(APP_CONTROL_COMPLETED_ACTION_LIMIT + 2);
  }),
);
