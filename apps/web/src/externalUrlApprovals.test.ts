import { describe, expect, it } from "vite-plus/test";

import { createExternalUrlApprovalStore, isLoopbackHttpUrl } from "./externalUrlApprovals";
import { createMemoryStorage } from "./lib/storage";

describe("externalUrlApprovals", () => {
  it("recognizes only requested loopback host forms", () => {
    expect(isLoopbackHttpUrl("http://localhost")).toBe(true);
    expect(isLoopbackHttpUrl("https://dev.admin.lotus.localhost/path")).toBe(true);
    expect(isLoopbackHttpUrl("http://127.255.0.1:3000")).toBe(true);
    expect(isLoopbackHttpUrl("http://[::1]:3000")).toBe(true);
    expect(isLoopbackHttpUrl("https://localhost.example.com")).toBe(false);
    expect(isLoopbackHttpUrl("https://example.com")).toBe(false);
  });

  it("bounds approvals and exposes exact revoke and clear seams", () => {
    const approvals = createExternalUrlApprovalStore(createMemoryStorage());
    for (let index = 0; index <= 200; index += 1) {
      approvals.approve(`https://example.com/${index}`);
    }
    expect(approvals.has("https://example.com/0")).toBe(false);
    expect(approvals.has("https://example.com/200")).toBe(true);

    approvals.revoke("https://example.com/200");
    expect(approvals.has("https://example.com/200")).toBe(false);

    approvals.clear();
    expect(approvals.has("https://example.com/199")).toBe(false);
  });
});
