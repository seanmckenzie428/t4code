"use client";

import { useCallback, useEffect, useRef } from "react";

import { claimPreviewHistoryHover, releasePreviewHistoryHover } from "./previewHistoryHover";

export function usePreviewHistoryHover(runtimeTabId: string | null, enabled = true) {
  const ownerRef = useRef<object | null>(null);
  const hoveredRef = useRef(false);
  if (ownerRef.current === null) ownerRef.current = {};

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    if (!enabled) {
      hoveredRef.current = false;
      releasePreviewHistoryHover(owner);
      return;
    }
    if (hoveredRef.current) claimPreviewHistoryHover(owner, { runtimeTabId });
    return () => releasePreviewHistoryHover(owner);
  }, [enabled, runtimeTabId]);

  const onMouseEnter = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || !enabled) return;
    hoveredRef.current = true;
    claimPreviewHistoryHover(owner, { runtimeTabId });
  }, [enabled, runtimeTabId]);

  const onMouseLeave = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    hoveredRef.current = false;
    releasePreviewHistoryHover(owner);
  }, []);

  return { onMouseEnter, onMouseLeave } as const;
}
