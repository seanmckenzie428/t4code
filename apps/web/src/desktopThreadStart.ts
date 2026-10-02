import type { CreateThreadInput, StartThreadTurnInput } from "@t3tools/client-runtime/operations";
import {
  CommandId,
  MessageId,
  ThreadId,
  type DesktopAppStartThreadRequest,
  type ModelSelection,
  type RuntimeMode,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";

export async function startDesktopThread(
  project: ScopedProjectRef,
  request: DesktopAppStartThreadRequest,
  defaults: { modelSelection: ModelSelection; runtimeMode: RuntimeMode },
  dependencies: {
    waitForThread: (threadRef: ScopedThreadRef) => Promise<void>;
    navigate: (threadRef: ScopedThreadRef) => Promise<void>;
    create: (input: CreateThreadInput) => Promise<void>;
    start: (input: StartThreadTurnInput) => Promise<void>;
  },
) {
  const threadId = ThreadId.make(request.requestId);
  const createdAt = new Date().toISOString();
  await dependencies.create({
    commandId: CommandId.make(`${request.requestId}:create`),
    threadId,
    projectId: project.projectId,
    kind: "project",
    title: request.title,
    ...defaults,
    interactionMode: request.prompt ? "plan" : "default",
    branch: request.branch,
    worktreePath: request.worktreePath,
    createdAt,
  });
  if (!request.prompt) {
    const threadRef = { environmentId: project.environmentId, threadId };
    // Command acceptance precedes the shell subscription. Routing too early
    // makes ThreadRouteView treat this thread as missing and open a fresh draft.
    await dependencies.waitForThread(threadRef);
    await dependencies.navigate(threadRef);
    return { threadId };
  }
  const messageId = MessageId.make(`${request.requestId}:message`);
  // Separate persisted commands retain receipt deduplication; no worktree bootstrap
  // or titleSeed is needed for an already-prepared checkout and explicit issue title.
  await dependencies.start({
    commandId: CommandId.make(`${request.requestId}:start`),
    threadId,
    message: { messageId, role: "user", text: request.prompt, attachments: [] },
    ...defaults,
    interactionMode: "plan",
    createdAt,
  });
  // External launches leave the user's current conversation and composer untouched.
  return { threadId, messageId };
}
