import { expect, it } from "vite-plus/test";
import {
  AppCommandId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type AppCommandDescriptor,
  type AppControlSnapshot,
} from "@t3tools/contracts";

import {
  isAgentDiscoverableCommand,
  isAgentInvocableCommandId,
  requiresExplicitAppControlConfirmation,
  scopeAppControlSnapshot,
} from "./handlers.ts";

const descriptor = (id: string, risk: AppCommandDescriptor["risk"]): AppCommandDescriptor => ({
  id: AppCommandId.make(id),
  version: 1,
  owner: "client",
  title: id,
  description: id,
  risk,
  requiredGrant: null,
  inputSchema: {},
  outputSchema: {},
});

it("limits project-agent status to its own project and thread", () => {
  const ownProjectId = ProjectId.make("own-project");
  const ownThreadId = ThreadId.make("own-thread");
  const otherProjectId = ProjectId.make("other-project");
  const otherThreadId = ThreadId.make("other-thread");
  const snapshot = {
    sequence: 1,
    environmentId: EnvironmentId.make("local"),
    focusedClient: {
      clientId: "client",
      surface: "web",
      projectId: otherProjectId,
      threadId: otherThreadId,
      quickChatOpen: false,
      activePanel: null,
      revision: 1,
    },
    projects: [
      { id: ownProjectId, title: "Own", kind: "workspace" },
      { id: otherProjectId, title: "Other", kind: "workspace" },
    ],
    threads: [
      { id: ownThreadId, projectId: ownProjectId, title: "Own", kind: "project" },
      { id: otherThreadId, projectId: otherProjectId, title: "Other", kind: "project" },
    ],
    views: [
      {
        id: "own",
        title: "Own",
        kind: "native",
        revision: 1,
        scope: { kind: "thread", threadId: ownThreadId },
      },
      {
        id: "other",
        title: "Other",
        kind: "native",
        revision: 1,
        scope: { kind: "thread", threadId: otherThreadId },
      },
    ],
    commands: [descriptor("thread.rename", "mutate"), descriptor("approval.respond", "mutate")],
  } satisfies AppControlSnapshot;

  const scoped = scopeAppControlSnapshot(snapshot, {
    kind: "thread-agent",
    projectId: ownProjectId,
    threadId: ownThreadId,
  });

  expect(scoped.focusedClient).toBeNull();
  expect(scoped.projects.map((project) => project.id)).toEqual([ownProjectId]);
  expect(scoped.threads.map((thread) => thread.id)).toEqual([ownThreadId]);
  expect(scoped.views.map((view) => view.id)).toEqual(["own"]);
  expect(scoped.commands.map((command) => command.id)).toEqual(["thread.rename"]);
});

it("never executes destructive and publication commands without a confirmation host", () => {
  expect(requiresExplicitAppControlConfirmation("project.delete")).toBe(true);
  expect(requiresExplicitAppControlConfirmation("thread.checkpoint.revert")).toBe(true);
  expect(requiresExplicitAppControlConfirmation("source-control.publish")).toBe(true);
  expect(requiresExplicitAppControlConfirmation("view.delete")).toBe(true);
  expect(requiresExplicitAppControlConfirmation("thread.rename")).toBe(false);
});

it("never exposes approval, user-input, grant, or forbidden commands", () => {
  expect(isAgentDiscoverableCommand(descriptor("thread.rename", "mutate"))).toBe(true);
  expect(isAgentDiscoverableCommand(descriptor("approval.respond", "mutate"))).toBe(false);
  expect(isAgentDiscoverableCommand(descriptor("user-input.respond", "mutate"))).toBe(false);
  expect(isAgentDiscoverableCommand(descriptor("capability-grant.mutate", "mutate"))).toBe(false);
  expect(isAgentDiscoverableCommand(descriptor("internal.command", "forbidden"))).toBe(false);
  expect(isAgentInvocableCommandId("approval.respond")).toBe(false);
  expect(isAgentInvocableCommandId("thread.rename")).toBe(true);
});
