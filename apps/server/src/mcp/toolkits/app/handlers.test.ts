import { expect, it } from "vite-plus/test";
import { AppCommandId, type AppCommandDescriptor } from "@t3tools/contracts";

import {
  isAgentDiscoverableCommand,
  isAgentInvocableCommandId,
  requiresExplicitAppControlConfirmation,
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
