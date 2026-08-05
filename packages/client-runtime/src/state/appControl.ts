import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createAppControlEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    requests: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:app-control:requests",
      tag: WS_METHODS.appControlConnect,
      idleTtlMs: 0,
    }),
    respond: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:app-control:respond",
      tag: WS_METHODS.appControlRespond,
      scheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.connectionId, input.requestId]),
      },
    }),
    focusHost: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:app-control:focus-host",
      tag: WS_METHODS.appControlFocusHost,
      scheduler,
      concurrency: {
        mode: "latest",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.clientId, input.connectionId]),
      },
    }),
    invokeServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:app-control:invoke-server",
      tag: WS_METHODS.appControlInvokeServer,
      scheduler,
      concurrency: { mode: "parallel" },
    }),
  };
}
