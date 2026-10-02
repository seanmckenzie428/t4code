import { expect, it } from "@effect/vitest";
import {
  AppActionId,
  AppCommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as AppControlServerExecutor from "./AppControlServerExecutor.ts";
import { AppControlTerminalCommandRunner } from "./AppControlTerminalCommandRunner.ts";
import { OrchestratorV2 as OrchestrationEngineService } from "../orchestration-v2/Orchestrator.ts";
import * as Layer from "effect/Layer";
import { AppControlState as ProjectionSnapshotQuery } from "./AppControlState.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  ThreadArchiveError,
  ThreadArchiveService,
} from "../orchestration-v2/ThreadArchiveService.ts";

type OrchestrationCommand =
  | OrchestrationV2ServerCommand
  | ({ type: "project.meta.update" } & ProjectService.ProjectUpdateInput)
  | ({ type: "project.delete" } & ProjectService.ProjectDeleteInput);

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
) => {
  let snapshotSequence = 0;
  const project = {
    id: ProjectId.make("project-1"),
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  const record = (command: OrchestrationCommand) =>
    dispatch(command).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          snapshotSequence = result.sequence;
        }),
      ),
    );
  return AppControlServerExecutor.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) =>
            record(command).pipe(Effect.map((result) => ({ ...result, storedEvents: [] }))),
          getShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence,
              schemaVersion: 1,
              threads: [],
              archivedThreads: [],
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          update: (input) =>
            record({ ...input, type: "project.meta.update" }).pipe(Effect.as(project)),
          delete: (input) => record({ ...input, type: "project.delete" }).pipe(Effect.as(project)),
        }),
      ),
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
};

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

const makeArchiveService = (
  dispatch: ThreadArchiveService["Service"]["dispatch"],
  runWithWork: ThreadArchiveService["Service"]["runWithWork"] = (_threadId, work) => work,
) =>
  ThreadArchiveService.of({
    dispatch,
    prepareForWork: () => Effect.void,
    runWithWork,
    runWithArchiveLock: (_threadId, work) => work,
    sweep: Effect.void,
    reconcile: Effect.void,
    start: () => Effect.void,
    drain: Effect.void,
  });

for (const action of ["thread.archive", "thread.unarchive"] as const) {
  it.effect(`waits for shared ${action} completion before returning an action receipt`, () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<OrchestrationCommand>();
      const finished = yield* Deferred.make<{ sequence: number }, ThreadArchiveError>();
      let rawDispatchCount = 0;
      const executor = yield* makeExecutor(() =>
        Effect.sync(() => {
          rawDispatchCount += 1;
          return { sequence: 1 };
        }),
      ).pipe(
        Effect.provideService(
          ThreadArchiveService,
          makeArchiveService((command) =>
            Deferred.succeed(entered, command).pipe(Effect.andThen(Deferred.await(finished))),
          ),
        ),
      );
      const result = yield* Effect.forkChild(
        executor.execute({
          scope,
          invocation: {
            actionId: AppActionId.make(`${action}-native-pending`),
            commandId: AppCommandId.make(action),
            args: { threadId: "thread-1" },
          },
        }),
      );
      expect(yield* Deferred.await(entered)).toMatchObject({ type: action, threadId: "thread-1" });
      expect(result.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(finished, { sequence: 47 });
      expect(yield* Fiber.join(result)).toMatchObject({
        status: "completed",
        receipt: { sequence: 47, revision: 47 },
      });
      expect(rawDispatchCount).toBe(0);
    }),
  );

  it.effect(`reports native ${action} failure instead of a successful engine receipt`, () =>
    Effect.gen(function* () {
      let rawDispatchCount = 0;
      const executor = yield* makeExecutor(() =>
        Effect.sync(() => {
          rawDispatchCount += 1;
          return { sequence: 1 };
        }),
      ).pipe(
        Effect.provideService(
          ThreadArchiveService,
          makeArchiveService(() =>
            Effect.fail(new ThreadArchiveError({ message: "Native provider unavailable" })),
          ),
        ),
      );
      const result = yield* executor.execute({
        scope,
        invocation: {
          actionId: AppActionId.make(`${action}-native-failed`),
          commandId: AppCommandId.make(action),
          args: { threadId: "thread-1" },
        },
      });
      expect(result).toMatchObject({ status: "failed", error: { code: "execution-failed" } });
      expect(rawDispatchCount).toBe(0);
    }),
  );
}

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
        type: "thread.metadata.update",
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

it.effect("lets a regular chat start work in another thread", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const source = {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      kind: "project",
      deletedAt: null,
      messages: [{ role: "user", text: "Start work elsewhere", delegation: undefined }],
    };
    const target = {
      id: ThreadId.make("thread-2"),
      projectId: ProjectId.make("project-2"),
      kind: "project",
      deletedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      messages: [],
      session: null,
      latestTurn: null,
    };
    const projections = ProjectionSnapshotQuery.of({
      getThreadDetailById: (threadId: ThreadId) =>
        Effect.succeed(Option.some(threadId === source.id ? source : target)),
      getSnapshot: () => Effect.succeed({ threads: [target] } as never),
    } as never);
    const settings = ServerSettingsService.of({
      getSettings: Effect.succeed({ globalAssistant: { delegationEnabled: true } }),
    } as never);
    const executor = yield* makeExecutor(
      (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: 46 };
        }),
      { projections },
    ).pipe(Effect.provideService(ServerSettingsService, settings));

    const result = yield* executor.execute({
      scope: { ...scope, grants: new Set(["assistant:delegate"]) },
      invocation: {
        actionId: AppActionId.make("delegate-regular-chat"),
        commandId: AppCommandId.make("delegation.turn.start"),
        args: { threadId: "thread-2", text: "Continue the requested work." },
      },
    });

    expect(result).toMatchObject({ status: "completed", receipt: { sequence: 46 } });
    expect(commands).toEqual([
      expect.objectContaining({
        type: "message.dispatch",
        threadId: "thread-2",
        delegation: {
          assistantThreadId: "thread-1",
          actionId: "delegate-regular-chat",
          depth: 1,
        },
      }),
    ]);
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

it.effect("waits for shared work admission before running a one-shot terminal command", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<ThreadId>();
    const admitted = yield* Deferred.make<void, ThreadArchiveError>();
    let runCount = 0;
    const executor = yield* makeExecutor(() => Effect.die("Terminal work must not dispatch."), {
      projections: terminalProjections,
      terminalRun: () =>
        Effect.sync(() => {
          runCount += 1;
          return {
            cwd: "/workspace/project/.worktrees/thread-1",
            stdout: "ready\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }),
    }).pipe(
      Effect.provideService(
        ThreadArchiveService,
        makeArchiveService(
          () => Effect.die("Terminal work must not dispatch."),
          (threadId, work) =>
            Deferred.succeed(entered, threadId).pipe(
              Effect.andThen(Deferred.await(admitted)),
              Effect.andThen(work),
            ),
        ),
      ),
    );
    const result = yield* Effect.forkChild(
      executor.execute({
        scope,
        invocation: {
          actionId: AppActionId.make("terminal-waiting-for-native-restore"),
          commandId: AppCommandId.make("terminal.command.run"),
          args: { command: "pwd" },
        },
      }),
    );
    expect(yield* Deferred.await(entered)).toBe(scope.principal.threadId);
    expect(runCount).toBe(0);
    expect(result.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(admitted, undefined);
    expect(yield* Fiber.join(result)).toMatchObject({
      status: "completed",
      result: { stdout: "ready\n", exitCode: 0 },
    });
    expect(runCount).toBe(1);
  }),
);

it.effect("reports failed native work admission without running a one-shot terminal command", () =>
  Effect.gen(function* () {
    let runCount = 0;
    const executor = yield* makeExecutor(() => Effect.die("Terminal work must not dispatch."), {
      projections: terminalProjections,
      terminalRun: () =>
        Effect.sync(() => {
          runCount += 1;
        }).pipe(Effect.andThen(Effect.die("Failed work admission must not run terminal work."))),
    }).pipe(
      Effect.provideService(
        ThreadArchiveService,
        makeArchiveService(
          () => Effect.die("Terminal work must not dispatch."),
          () => Effect.fail(new ThreadArchiveError({ message: "Native restore failed" })),
        ),
      ),
    );
    const result = yield* executor.execute({
      scope,
      invocation: {
        actionId: AppActionId.make("terminal-native-restore-failed"),
        commandId: AppCommandId.make("terminal.command.run"),
        args: { command: "pwd" },
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "execution-failed", message: "Native restore failed" },
    });
    expect(runCount).toBe(0);
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
