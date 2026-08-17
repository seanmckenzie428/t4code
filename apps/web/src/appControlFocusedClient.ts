import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export function resolveAppControlFocusedThread(input: {
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly threads: ReadonlyArray<{ readonly id: ThreadId; readonly projectId: ProjectId }>;
}): { readonly projectId: ProjectId; readonly threadId: ThreadId } | null {
  if (input.routeThreadRef?.environmentId !== input.environmentId) return null;
  const thread = input.threads.find((candidate) => candidate.id === input.routeThreadRef?.threadId);
  return thread === undefined ? null : { projectId: thread.projectId, threadId: thread.id };
}
