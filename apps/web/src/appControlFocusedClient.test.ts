import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { resolveAppControlFocusedThread } from "./appControlFocusedClient";

const environmentId = EnvironmentId.make("environment-1");
const thread = {
  id: ThreadId.make("thread-2"),
  projectId: ProjectId.make("project-2"),
};

it("tracks the thread currently focused by the user", () => {
  expect(
    resolveAppControlFocusedThread({
      environmentId,
      routeThreadRef: scopeThreadRef(environmentId, thread.id),
      threads: [thread],
    }),
  ).toEqual({ projectId: thread.projectId, threadId: thread.id });
});

it("does not leak focus from another environment", () => {
  expect(
    resolveAppControlFocusedThread({
      environmentId,
      routeThreadRef: scopeThreadRef(EnvironmentId.make("environment-2"), thread.id),
      threads: [thread],
    }),
  ).toBeNull();
});
