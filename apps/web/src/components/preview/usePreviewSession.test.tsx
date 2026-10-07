import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  EnvironmentId,
  ThreadId,
  type PreviewEvent,
  type PreviewListResult,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  previewStateAtom,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { usePreviewSession } from "./usePreviewSession";

const mocks = vi.hoisted(() => ({ list: vi.fn(), events: vi.fn() }));
vi.mock("~/state/preview", () => ({ previewEnvironment: mocks }));

let renderer: ReactTestRenderer | undefined;
let sequence = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetPreviewStateForTests();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "loads an authoritative list when the real session hook mounts (cached: %s)",
  async (cached) => {
    const ref = {
      environmentId: EnvironmentId.make("preview-session"),
      threadId: ThreadId.make(`thread-${++sequence}`),
    };
    const fresh: PreviewListResult = {
      serverEpoch: "current-server",
      revision: 1,
      sessions: [
        {
          threadId: ref.threadId,
          tabId: "tab_1",
          navStatus: { _tag: "Success", url: "http://localhost:3000/", title: "App" },
          canGoBack: false,
          canGoForward: false,
          updatedAt: "2026-10-07T00:00:00.000Z",
        },
      ],
    };
    let result: PreviewListResult = { serverEpoch: "previous-server", revision: 0, sessions: [] };
    const fetchList = vi.fn(() => AsyncResult.success(result));
    // Use the real lazy SWR wrapper used by createEnvironmentQueryAtomFamily.
    const sessions = Atom.make(fetchList).pipe(
      Atom.swr({ staleTime: 5_000, revalidateOnMount: true }),
    );
    const events = Atom.make(AsyncResult.initial<PreviewEvent>());
    mocks.list.mockReturnValue(sessions);
    mocks.events.mockReturnValue(events);
    if (cached) {
      appAtomRegistry.get(sessions);
      reconcilePreviewServerSessions(ref, fresh);
    }
    result = fresh;
    fetchList.mockClear();
    const seenEpochs: Array<string | null> = [];
    const unsubscribe = appAtomRegistry.subscribe(
      previewStateAtom(scopedThreadKey(ref)),
      (state) => {
        seenEpochs.push(state.serverEpoch);
      },
    );
    function Probe() {
      usePreviewSession(ref);
      return null;
    }
    try {
      await act(async () => {
        renderer = create(
          <AppAtomRegistryProvider>
            <Probe />
          </AppAtomRegistryProvider>,
        );
      });
      expect(fetchList).toHaveBeenCalled();
      expect(readThreadPreviewState(ref)).toMatchObject({
        serverEpoch: "current-server",
        listServerEpoch: "current-server",
        sessions: { tab_1: fresh.sessions[0] },
      });
      expect(seenEpochs).not.toContain("previous-server");
    } finally {
      unsubscribe();
    }
  },
);
