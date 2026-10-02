import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OrchestratorV2DispatchResult, OrchestratorV2Error } from "./Orchestrator.ts";

import type { ThreadArchiveService } from "./ThreadArchiveService.ts";
type AdmitWork = ThreadArchiveService["Service"]["runWithWork"];
type Dispatch = (
  command: OrchestrationV2ServerCommand,
) => Effect.Effect<OrchestratorV2DispatchResult, OrchestratorV2Error>;
const Bypass = Context.Reference<boolean>("t3/archive/AdmissionBypass", {
  defaultValue: () => false,
});
/** Archive commits reenter orchestration without repeating their native side effect. */
export const withoutArchiveAdmission = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, Bypass, true);

export class ThreadArchiveAdmission extends Context.Service<
  ThreadArchiveAdmission,
  {
    readonly registerWork: (admit: AdmitWork) => Effect.Effect<void>;
    readonly admitWork: AdmitWork;
    readonly register: (dispatch: Dispatch) => Effect.Effect<void>;
    readonly dispatch: (
      command: OrchestrationV2ServerCommand,
      execute: Dispatch,
    ) => ReturnType<Dispatch>;
  }
>()("t3/orchestration-v2/ThreadArchiveAdmission") {}
export const layer = Layer.sync(ThreadArchiveAdmission, () => {
  let archive: Dispatch | undefined;
  let admit: AdmitWork | undefined;
  return ThreadArchiveAdmission.of({
    registerWork: (work) =>
      Effect.sync(() => {
        admit = work;
      }),
    admitWork: (threadId, work) => (admit === undefined ? work : admit(threadId, work)),
    register: (dispatch) =>
      Effect.sync(() => {
        archive = dispatch;
      }),
    dispatch: (command, execute) =>
      Effect.gen(function* () {
        const bypass = yield* Bypass;
        if (bypass || archive === undefined) return yield* execute(command);
        return yield* archive(command);
      }),
  });
});
