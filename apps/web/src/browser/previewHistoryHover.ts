export interface PreviewHistoryHoverTarget {
  readonly runtimeTabId: string | null;
}

const activeHovers = new Map<
  object,
  { readonly sequence: number; readonly target: PreviewHistoryHoverTarget }
>();
let hoverSequence = 0;

export function claimPreviewHistoryHover(owner: object, target: PreviewHistoryHoverTarget): void {
  hoverSequence += 1;
  activeHovers.set(owner, { sequence: hoverSequence, target });
}

export function releasePreviewHistoryHover(owner: object): void {
  activeHovers.delete(owner);
}

export function readPreviewHistoryHover(): PreviewHistoryHoverTarget | null {
  let latest: { readonly sequence: number; readonly target: PreviewHistoryHoverTarget } | null =
    null;
  for (const hover of activeHovers.values()) {
    if (latest === null || hover.sequence > latest.sequence) latest = hover;
  }
  return latest?.target ?? null;
}
