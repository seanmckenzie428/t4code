import type { OrchestrationV2ThreadProjection, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";

/** Keep app-control's ownership checks independent of provider run representation. */
function controlThread(projection: OrchestrationV2ThreadProjection) {
  const active = projection.runs.findLast((run) =>
    ["preparing", "starting", "running", "waiting"].includes(run.status),
  );
  const latest = projection.runs.at(-1);
  return {
    ...projection.thread,
    kind: projection.thread.kind ?? "project",
    messages: projection.messages.map((message) => ({
      ...message,
      turnId: message.runId,
      createdAt: DateTime.formatIso(message.createdAt),
    })),
    session:
      active === undefined
        ? null
        : {
            status:
              active.status === "preparing" || active.status === "starting"
                ? ("starting" as const)
                : ("running" as const),
          },
    latestTurn:
      latest === undefined ? null : { requestedAt: DateTime.formatIso(latest.requestedAt) },
  };
}
export type AppControlThread = ReturnType<typeof controlThread>;

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const getThreadShellById = (threadId: ThreadId) =>
    orchestrator
      .getThreadShell(threadId)
      .pipe(
        Effect.map((thread) =>
          Option.fromNullishOr(
            thread === null ? null : { ...thread, kind: thread.kind ?? "project" },
          ),
        ),
      );
  const getThreadDetailById = (threadId: ThreadId) =>
    getThreadShellById(threadId).pipe(
      Effect.flatMap((shell) =>
        Option.isNone(shell)
          ? Effect.succeed(Option.none<AppControlThread>())
          : orchestrator
              .getThreadProjection(threadId)
              .pipe(Effect.map((value) => Option.some(controlThread(value)))),
      ),
    );
  const getShellSnapshot = () =>
    Effect.all([
      orchestrator.getShellSnapshot(),
      orchestrator.getShellSnapshot({ location: "archive" }),
    ]).pipe(
      Effect.map(([active, archive]) => ({
        threads: [...active.threads, ...archive.archivedThreads],
      })),
    );
  const getSnapshot = () =>
    getShellSnapshot().pipe(
      Effect.flatMap(({ threads }) =>
        Effect.forEach(threads, (thread) => orchestrator.getThreadProjection(thread.id)),
      ),
      Effect.map((threads) => ({ threads: threads.map(controlThread) })),
    );
  return {
    getSnapshotSequence: () =>
      orchestrator
        .getShellSnapshot()
        .pipe(Effect.map((snapshot) => ({ snapshotSequence: snapshot.snapshotSequence }))),
    getThreadShellById,
    getThreadDetailById,
    getProjectShellById: (projectId: ProjectId) =>
      projects
        .getShell(projectId)
        .pipe(
          Effect.map(Option.map((project) => ({ ...project, kind: project.kind ?? "workspace" }))),
        ),
    getShellSnapshot,
    getSnapshot,
  };
});

export class AppControlState extends Context.Service<
  AppControlState,
  Effect.Success<typeof make>
>()("t3/mcp/AppControlState") {}
export const layer = Layer.effect(AppControlState, make);
