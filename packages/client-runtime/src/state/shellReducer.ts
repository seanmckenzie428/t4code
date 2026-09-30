import * as Arr from "effect/Array";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

/** Archive queries follow lifecycle changes without refetching for message updates. */
export function shellEventChangesArchive(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): boolean {
  if (event.sequence <= snapshot.snapshotSequence) return false;
  if (event.kind === "project-removed") return true;
  if (event.kind === "thread-removed") {
    return (
      event.archiveChanged === true ||
      snapshot.threads.some((thread) => thread.id === event.threadId)
    );
  }
  if (event.kind !== "thread-upserted") return false;
  if (event.archiveChanged === true) return true;
  const previous = snapshot.threads.find(
    (thread) => thread.id === event.thread.id,
  )?.archiveLifecycle;
  const current = event.thread.archiveLifecycle;
  return (
    previous?.operationId !== current?.operationId ||
    previous?.direction !== current?.direction ||
    previous?.status !== current?.status ||
    previous?.lastError !== current?.lastError
  );
}

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);
      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
