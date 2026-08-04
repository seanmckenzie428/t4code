import { createAppControlEnvironmentAtoms } from "@t3tools/client-runtime/state/app-control";

import { connectionAtomRuntime } from "../connection/runtime";

export const appControlEnvironment = createAppControlEnvironmentAtoms(connectionAtomRuntime);
