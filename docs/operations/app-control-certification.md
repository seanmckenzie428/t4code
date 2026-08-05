# App control certification

Use isolated T3 userdata. Never certify against live userdata.

## Automated checks

Run focused contract, registry, policy, broker, executor, audit, assistant,
delegation, view, sandbox, extension, Lotus fixture, and mobile decode tests.
Typecheck contracts, client runtime, server, web, mobile, and Lotus integration.
The MCP HTTP lifecycle test needs a temporary local port.

## Web and desktop checklist

1. Pair an isolated client. Configure supported Codex. Verify drawer survives
   navigation, medium layout hides the work panel, and narrow layout overlays.
2. Invoke a server command without a client host. With two clients, verify
   navigation follows focus and disconnect cancels pending client work.
3. Trigger destructive action. Verify exact target, environment, descendants,
   recoverability, and no remember option. Exercise allow, decline, expiry,
   disconnect, interruption, and revision drift.
4. Present/update/close native view. Restart/reconnect and verify persistence.
   Verify project pin creates only a review proposal.
5. Open bundled rich view. Verify opaque origin, command allowlist, duplicate
   rejection, CSP, and iframe destruction. Verify remote/origin views block.
6. Grant delegation, start three turns, reject fourth, stop one, verify origin,
   revoke grant, and reject new delegation.
7. Repeat drawer, confirmation, preview, terminal, and iframe checks in desktop.
   Connect remote web and verify focus handoff.

## Extension and Lotus checklist

1. Preview exact transport identity/capabilities. Approve, connect, then change
   one argument and verify reapproval plus disconnect.
2. Disable/remove extension and verify core T3 remains unchanged.
3. Exercise healthy, unhealthy, drift, unavailable CLI, malformed output,
   long-create, and orphan/adopt Lotus fixtures.
4. With installed Lotus CLI, verify reads, lifecycle, destructive confirmation,
   orphan adoption, and typed terminal/preview/URL handoffs.
