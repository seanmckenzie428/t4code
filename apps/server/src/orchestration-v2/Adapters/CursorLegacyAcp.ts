import {
  ProviderDriverKind,
  type CursorSettings,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ChildProcessSpawner } from "effect/unstable/process";
import {
  CursorAskQuestionRequest,
  CursorCreatePlanRequest,
  CursorUpdateTodosRequest,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
} from "../../provider/acp/CursorAcpExtension.ts";
import {
  applyCursorAcpModelSelection,
  makeCursorAcpRuntime,
  resolveCursorAcpModeId,
} from "../../provider/acp/CursorAcpSupport.ts";
import { resolveCursorAcpBaseModelId } from "../../provider/acp/CursorAcpModelSelection.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Options,
  type AcpAdapterV2Flavor,
} from "./AcpAdapterV2.ts";
import type * as ProviderAdapter from "../ProviderAdapter.ts";

const CURSOR = ProviderDriverKind.make("cursor");

type Options = Omit<AcpAdapterV2Options, "flavor"> & {
  readonly settings: CursorSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly makeRuntime?: AcpAdapterV2Flavor["makeRuntime"];
};

export function makeLegacyCursorAcpFlavor(options: Options): AcpAdapterV2Flavor {
  return {
    driver: CURSOR,
    capabilities: {
      ...AcpProviderCapabilitiesV2,
      sessions: {
        ...AcpProviderCapabilitiesV2.sessions,
        supportsMultipleProviderThreadsPerSession: false,
        supportsModelSwitchInSession: true,
        supportsRuntimeModeSwitchInSession: false,
      },
      threads: {
        ...AcpProviderCapabilitiesV2.threads,
        canForkThread: false,
        canForkFromTurn: false,
        canRollbackThread: false,
      },
      tools: { ...AcpProviderCapabilitiesV2.tools, supportsMcpTools: true },
    },
    runtimeHarness: "Cursor CLI",
    supportsCompaction: true,
    compactionCommand: "/compress",
    clientCapabilitiesMeta: { parameterizedModelPicker: true },
    makeRuntime:
      options.makeRuntime ??
      ((input) =>
        makeCursorAcpRuntime({
          ...input,
          cursorSettings: options.settings,
          environment: { ...options.environment, ...input.processEnvironment },
          runtimeMode: input.runtimePolicy.runtimeMode,
          childProcessSpawner: options.childProcessSpawner,
        })),
    resolveModelId: (selection) => resolveCursorAcpBaseModelId(selection.model),
    applyModelSelection: ({ runtime, modelSelection }) =>
      applyCursorAcpModelSelection({
        runtime,
        model: modelSelection.model,
        selections: modelSelection.options,
        mapError: ({ cause }) => cause,
      }).pipe(Effect.as(resolveCursorAcpBaseModelId(modelSelection.model))),
    sessionModeForPolicy: (policy, modeState) => resolveCursorAcpModeId({ ...policy, modeState }),
    registerExtensions: (context) =>
      Effect.gen(function* () {
        yield* context.runtime.handleExtRequest(
          "cursor/ask_question",
          CursorAskQuestionRequest,
          (params, requestContext) =>
            Effect.gen(function* () {
              const result = yield* context.requestUserInput(
                {
                  nativeItemId: params.toolCallId,
                  nativeRequestId: params.toolCallId,
                  questions: extractAskQuestions(params),
                },
                requestContext,
              );
              yield* result.acknowledgeNativeResponse;
              return { answers: result.answers ?? {} };
            }),
        );
        yield* context.runtime.handleExtRequest(
          "cursor/create_plan",
          CursorCreatePlanRequest,
          (params) =>
            context
              .captureProposedPlan({ planMarkdown: extractPlanMarkdown(params) })
              .pipe(Effect.as({ accepted: true })),
        );
        yield* context.runtime.handleExtNotification(
          "cursor/update_todos",
          CursorUpdateTodosRequest,
          (params) =>
            context.updatePlan(
              extractTodosAsPlan(params).plan.map((entry) => ({
                content: entry.step,
                priority: "medium",
                status: entry.status === "inProgress" ? "in_progress" : entry.status,
              })),
            ),
        );
      }),
  };
}

const markLegacyThread = (
  thread: OrchestrationV2ProviderThread,
): OrchestrationV2ProviderThread => ({
  ...thread,
  nativeMetadata: { ...thread.nativeMetadata, legacyCursorAcp: true },
});

const legacySession = (
  session: OrchestrationV2ProviderSession,
): OrchestrationV2ProviderSession => ({
  ...session,
  capabilities: {
    ...session.capabilities,
    threads: {
      ...session.capabilities.threads,
      canForkThread: false,
      canForkFromTurn: false,
      canRollbackThread: false,
    },
  },
});

function markLegacyRuntime(
  runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime,
): ProviderAdapter.ProviderAdapterV2SessionRuntime {
  const markEvent = (
    event: ProviderAdapter.ProviderAdapterV2Event,
  ): ProviderAdapter.ProviderAdapterV2Event =>
    event.type === "provider_thread.updated"
      ? { ...event, providerThread: markLegacyThread(event.providerThread) }
      : event.type === "provider_session.updated"
        ? { ...event, providerSession: legacySession(event.providerSession) }
        : event;
  return {
    ...runtime,
    providerSession: legacySession(runtime.providerSession),
    events: runtime.events.pipe(Stream.map(markEvent)),
    ...(runtime.subscribeEvents === undefined
      ? {}
      : {
          subscribeEvents: runtime.subscribeEvents.pipe(
            Effect.map((subscription) => ({
              ...subscription,
              events: subscription.events.pipe(Stream.map(markEvent)),
            })),
          ),
        }),
    ensureThread: (input) => runtime.ensureThread(input).pipe(Effect.map(markLegacyThread)),
    resumeThread: (input) => runtime.resumeThread(input).pipe(Effect.map(markLegacyThread)),
    forkThread: (input) => runtime.forkThread(input).pipe(Effect.map(markLegacyThread)),
    readThreadSnapshot: (input) =>
      runtime.readThreadSnapshot(input).pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          providerThread: markLegacyThread(snapshot.providerThread),
        })),
      ),
    rollbackThread: (input) =>
      runtime.rollbackThread(input).pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          providerThread: markLegacyThread(snapshot.providerThread),
        })),
      ),
  };
}

export function makeLegacyCursorAcpAdapter(
  options: Options,
): ProviderAdapter.ProviderAdapterV2Shape {
  const adapter = makeAcpAdapterV2({ ...options, flavor: makeLegacyCursorAcpFlavor(options) });
  return {
    ...adapter,
    openSession: (input) => adapter.openSession(input).pipe(Effect.map(markLegacyRuntime)),
  };
}

/** ACP session ids and SDK agent ids refer to different native stores. */
export function routeLegacyCursorAcp(
  sdk: ProviderAdapter.ProviderAdapterV2Shape,
  legacy: ProviderAdapter.ProviderAdapterV2Shape,
): ProviderAdapter.ProviderAdapterV2Shape {
  return {
    ...sdk,
    planSelectionTransition: legacy.planSelectionTransition,
    openSession: (input) =>
      input.initialNativeMetadata?.legacyCursorAcp === true
        ? legacy.openSession(input)
        : sdk.openSession(input),
  };
}
