"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";

import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions } from "~/previewStateStore";
import { useAtomCommand } from "~/state/use-atom-command";
import { previewEnvironment } from "~/state/preview";
import { addBrowserSurface } from "~/components/preview/addBrowserSurface";
import { toastManager } from "~/components/ui/toast";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef
          ? Object.values(previewState.sessions).map((snapshot) => ({
              threadRef,
              snapshot,
              runtimeTabId: previewRuntimeTabId(
                threadRef,
                previewState.serverEpoch,
                snapshot.tabId,
              ),
              pictureInPicture:
                previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
              zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
            }))
          : [];
      }),
    [previewByThreadKey],
  );
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const threadRefByRuntimeTabId = useMemo(
    () => new Map(sessions.map((session) => [session.runtimeTabId, session.threadRef])),
    [sessions],
  );

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onWindowOpen((request) => {
      const threadRef = threadRefByRuntimeTabId.get(request.sourceRuntimeTabId);
      if (!threadRef) return;
      void addBrowserSurface({
        threadRef,
        openPreview,
        ...(request.url === null ? {} : { url: request.url }),
      }).then((result) => {
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Unable to open browser tab",
          description: error instanceof Error ? error.message : "The browser tab could not open.",
        });
      });
    });
  }, [openPreview, threadRefByRuntimeTabId]);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {sessions.map(({ threadRef, snapshot, runtimeTabId, pictureInPicture, zoomFactor }) => {
        const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
        return (
          <HostedBrowserWebview
            key={runtimeTabId}
            threadRef={threadRef}
            tabId={snapshot.tabId}
            runtimeTabId={runtimeTabId}
            initialUrl={url}
            viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
            pictureInPicture={pictureInPicture}
            profileId={snapshot.profileId}
            zoomFactor={zoomFactor}
          />
        );
      })}
    </div>
  );
}
