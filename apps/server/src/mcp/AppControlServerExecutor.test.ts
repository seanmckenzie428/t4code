import { expect, it } from "@effect/vitest";
import {
  AppActionId,
  AppCommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as AppControlServerExecutor from "./AppControlServerExecutor.ts";
import { AppControlTerminalCommandRunner } from "./AppControlTerminalCommandRunner.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const scope = {
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
  grants: new Set(["thread:mutate"]),
  issuedAt: 1,
};

const makeExecutor = (
  dispatch: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }>,
  options: {
    readonly terminalRun?: AppControlTerminalCommandRunner["Service"]["run"];
    readonly projections?: ProjectionSnapshotQuery["Service"];
  } = {},
) =>
  AppControlServerExecutor.make.pipe(
    Effect.provideService(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        dispatch,
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
    ),
    Effect.provideService(
      AppControlTerminalCommandRunner,
      AppControlTerminalCommandRunner.of({
        run:
          options.terminalRun ??
          (() => Effect.die("Terminal runner should not be used by this test.")),
      }),
    ),
    options.projections === undefined
      ? (effect) => effect
      : Effect.provideService(ProjectionSnapshotQuery, options.projections),
  );

const terminalProjections = ProjectionSnapshotQuery.of({
  getThreadShellById: () =>
    Effect.succeed(
      Option.some({
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        worktreePath: "/workspace/project/.worktrees/thread-1",
      } as never),
    ),
  getProjectShellById: () =>
    Effect.succeed(
      Option.some({
        id: ProjectId.make("project-1"),
        kind: "workspace",
        workspaceRoot: "/workspace/project",
      } as never),
    ),
} as never);

it.effect("maps a rename to the canonical orchestration command and returns its receipt", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const executor = yield* makeExecutor((command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 42 };
      }),
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("rename-1"),
        commandId: AppCommandId.make("thread.rename"),
        args: { threadId: "thread-1", title: "Renamed" },
      },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        type: "thread.meta.update",
        threadId: "thread-1",
        title: "Renamed",
      }),
    ]);
    expect(result).toMatchObject({
      status: "completed",
      receipt: { sequence: 42, revision: 42, idempotentReplay: false },
    });
  }),
);

it.effect("rejects invalid arguments before dispatch", () =>
  Effect.gen(function* () {
    let dispatchCount = 0;
    const executor = yield* makeExecutor(() =>
      Effect.sync(() => {
        dispatchCount += 1;
        return { sequence: 1 };
      }),
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("rename-invalid"),
        commandId: AppCommandId.make("thread.rename"),
        args: { threadId: "thread-1", title: "" },
      },
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "invalid-input" } });
    expect(dispatchCount).toBe(0);
  }),
);

it.effect("saves a named terminal action in the current project", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const projections = ProjectionSnapshotQuery.of({
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: ProjectId.make("project-1"),
            kind: "workspace",
            scripts: [],
          } as never),
        ),
    } as never);
    const executor = yield* makeExecutor(
      (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: 43 };
        }),
      { projections },
    );
    const result = yield* executor.execute({
      scope: { ...scope, grants: new Set(["project:mutate"]) },
      invocation: {
        actionId: AppActionId.make("script-import-1"),
        commandId: AppCommandId.make("script.import"),
        args: {
          projectId: "project-1",
          script: {
            id: "lotus-tableplus-dev",
            name: "TablePlus",
            command: "lotus tableplus dev",
          },
        },
      },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        type: "project.meta.update",
        projectId: "project-1",
        scripts: [
          {
            id: "lotus-tableplus-dev",
            name: "TablePlus",
            command: "lotus tableplus dev",
            icon: "play",
            runOnWorktreeCreate: false,
            showInToolbar: false,
          },
        ],
      }),
    ]);
    expect(result).toMatchObject({ status: "completed", receipt: { sequence: 43 } });
  }),
);

it.effect("refuses to replace an existing terminal action definition", () =>
  Effect.gen(function* () {
    let dispatchCount = 0;
    const projections = ProjectionSnapshotQuery.of({
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: ProjectId.make("project-1"),
            kind: "workspace",
            scripts: [
              {
                id: "lotus-tableplus-dev",
                name: "TablePlus",
                command: "lotus tableplus other",
                icon: "play",
                runOnWorktreeCreate: false,
              },
            ],
          } as never),
        ),
    } as never);
    const executor = yield* makeExecutor(
      () =>
        Effect.sync(() => {
          dispatchCount += 1;
          return { sequence: 1 };
        }),
      { projections },
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("script-import-conflict"),
        commandId: AppCommandId.make("script.import"),
        args: {
          projectId: "project-1",
          script: {
            id: "lotus-tableplus-dev",
            name: "TablePlus",
            command: "lotus tableplus dev",
          },
        },
      },
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "conflict" } });
    expect(dispatchCount).toBe(0);
  }),
);

it.effect("creates agent-proposed actions in the menu and rejects agent placement", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const projections = ProjectionSnapshotQuery.of({
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: ProjectId.make("project-1"),
            kind: "workspace",
            scripts: [],
            customActions: [],
          } as never),
        ),
    } as never);
    const executor = yield* makeExecutor(
      (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: 44 };
        }),
      { projections },
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("action-upsert-1"),
        commandId: AppCommandId.make("project.action.upsert"),
        args: {
          projectId: "project-1",
          action: {
            id: "lotus-admin",
            name: "Admin",
            commandId: "ui.external-url.open",
            url: "https://dev.admin.lotus.localhost",
          },
        },
      },
    });
    expect(result.status).toBe("completed");
    expect(commands).toEqual([
      expect.objectContaining({
        type: "project.meta.update",
        customActions: [
          expect.objectContaining({
            id: "lotus-admin",
            icon: "external-link",
            placement: "menu",
          }),
        ],
      }),
    ]);

    const rejected = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("action-upsert-pin"),
        commandId: AppCommandId.make("project.action.upsert"),
        args: {
          projectId: "project-1",
          action: {
            id: "lotus-api",
            name: "API",
            commandId: "ui.external-url.open",
            url: "https://dev.api.lotus.localhost/local/dashboard",
            placement: "toolbar",
          },
        },
      },
    });
    expect(rejected).toMatchObject({ status: "failed", error: { code: "invalid-input" } });
    expect(commands).toHaveLength(1);
  }),
);

it.effect("preserves a user toolbar pin when an agent updates an action", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const projections = ProjectionSnapshotQuery.of({
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: ProjectId.make("project-1"),
            kind: "workspace",
            scripts: [],
            customActions: [
              {
                id: "lotus-admin",
                name: "Admin",
                icon: "globe",
                placement: "toolbar",
                commandId: "ui.external-url.open",
                args: { url: "https://old.example.com" },
              },
            ],
          } as never),
        ),
    } as never);
    const executor = yield* makeExecutor(
      (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: 45 };
        }),
      { projections },
    );
    yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("action-update-1"),
        commandId: AppCommandId.make("project.action.upsert"),
        args: {
          projectId: "project-1",
          action: {
            id: "lotus-admin",
            name: "Lotus Admin",
            commandId: "ui.external-url.open",
            url: "https://new.example.com",
          },
        },
      },
    });
    expect(commands[0]).toMatchObject({
      customActions: [
        expect.objectContaining({
          id: "lotus-admin",
          name: "Lotus Admin",
          icon: "globe",
          placement: "toolbar",
        }),
      ],
    });
  }),
);

it.effect("fails closed for a server command without an exact mapping", () =>
  Effect.gen(function* () {
    const executor = yield* makeExecutor(() => Effect.succeed({ sequence: 1 }));
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("script-1"),
        commandId: AppCommandId.make("script.run"),
        args: { scriptId: "dev", commandHash: "hash" },
      },
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "unsupported" } });
  }),
);

it.effect("runs a confirmed one-shot command in the current thread worktree", () =>
  Effect.gen(function* () {
    const runs: Array<{ command: string; allowedRoot: string; cwd?: string | undefined }> = [];
    let dispatchCount = 0;
    const executor = yield* makeExecutor(
      () =>
        Effect.sync(() => {
          dispatchCount += 1;
          return { sequence: 1 };
        }),
      {
        projections: terminalProjections,
        terminalRun: (input) =>
          Effect.sync(() => {
            runs.push(input);
            return {
              cwd: "/workspace/project/.worktrees/thread-1",
              stdout: "opened\n",
              stderr: "",
              exitCode: 0,
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }),
      },
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("terminal-1"),
        commandId: AppCommandId.make("terminal.command.run"),
        args: { command: "lotus tableplus dev" },
      },
    });

    expect(runs).toEqual([
      {
        command: "lotus tableplus dev",
        allowedRoot: "/workspace/project/.worktrees/thread-1",
      },
    ]);
    expect(dispatchCount).toBe(0);
    expect(result).toMatchObject({
      status: "completed",
      receipt: { idempotentReplay: false },
      result: { stdout: "opened\n", exitCode: 0 },
    });
  }),
);

it.effect("denies one-shot commands when the scoped thread is not in the scoped project", () =>
  Effect.gen(function* () {
    let runCount = 0;
    const projections = ProjectionSnapshotQuery.of({
      getThreadShellById: () =>
        Effect.succeed(
          Option.some({
            id: ThreadId.make("thread-1"),
            projectId: ProjectId.make("project-2"),
          } as never),
        ),
    } as never);
    const executor = yield* makeExecutor(() => Effect.succeed({ sequence: 1 }), {
      projections,
      terminalRun: () =>
        Effect.sync(() => {
          runCount += 1;
          return {} as never;
        }),
    });
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("terminal-wrong-project"),
        commandId: AppCommandId.make("terminal.command.run"),
        args: { command: "pwd" },
      },
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "forbidden" } });
    expect(runCount).toBe(0);
  }),
);
