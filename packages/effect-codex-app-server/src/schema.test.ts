import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import * as CodexSchema from "./schema.ts";

const subagentActivityKindGuards = [
  CodexSchema.ServerNotification__SubAgentActivityKind,
  CodexSchema.V2ItemStartedNotification__SubAgentActivityKind,
  CodexSchema.V2ItemCompletedNotification__SubAgentActivityKind,
  CodexSchema.V2ThreadReadResponse__SubAgentActivityKind,
  CodexSchema.V2ThreadResumeResponse__SubAgentActivityKind,
].map((schema) => Schema.is(schema));
const isServerCollabAgentTool = Schema.is(CodexSchema.ServerNotification__CollabAgentTool);
const isResumeCollabAgentTool = Schema.is(CodexSchema.V2ThreadResumeResponse__CollabAgentTool);
const isServerCollabAgentToolCallStatus = Schema.is(
  CodexSchema.ServerNotification__CollabAgentToolCallStatus,
);
const isResumeCollabAgentToolCallStatus = Schema.is(
  CodexSchema.V2ThreadResumeResponse__CollabAgentToolCallStatus,
);
const isThreadResumeResponse = Schema.is(CodexSchema.V2ThreadResumeResponse);

it("accepts Codex 0.150 multi-agent values", () => {
  for (const isSubagentActivityKind of subagentActivityKindGuards) {
    assert.equal(isSubagentActivityKind("completed"), true);
  }

  for (const tool of ["sendMessage", "followupTask", "interruptAgent", "listAgents"]) {
    assert.equal(isServerCollabAgentTool(tool), true);
    assert.equal(isResumeCollabAgentTool(tool), true);
  }

  assert.equal(isServerCollabAgentToolCallStatus("interrupted"), true);
  assert.equal(isResumeCollabAgentToolCallStatus("interrupted"), true);

  const resumeResponse = {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: "/tmp/project",
    model: "gpt-5.6-sol",
    modelProvider: "openai",
    sandbox: { type: "dangerFullAccess" },
    thread: {
      cliVersion: "0.150.0",
      createdAt: 0,
      cwd: "/tmp/project",
      ephemeral: false,
      id: "root-thread",
      modelProvider: "openai",
      preview: "",
      sessionId: "session-1",
      source: "cli",
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              agentsStates: {},
              id: "item-1",
              receiverThreadIds: ["child-thread"],
              senderThreadId: "root-thread",
              status: "interrupted",
              tool: "followupTask",
              type: "collabAgentToolCall",
            },
          ],
        },
      ],
      updatedAt: 0,
    },
  };

  assert.equal(isThreadResumeResponse(resumeResponse), true);
});
