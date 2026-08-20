import {
  INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE,
  HORIZONTAL_WHEEL_GESTURE_RESET_MS,
  historyDirectionFromMouseButton,
  horizontalScrollContainerOwnsDelta,
  reduceHorizontalWheelGesture,
  type HistoryGestureDirection,
  type HorizontalWheelGestureState,
} from "./historyGesture.ts";

export interface HistoryGestureEventController {
  readonly handleAuxClick: (event: MouseEvent) => void;
  readonly handleMouseDown: (event: MouseEvent) => void;
  readonly handleMouseUp: (event: MouseEvent) => void;
  readonly handleWheel: (event: WheelEvent) => void;
}

export function horizontalScrollableDomPathConsumesDelta(
  path: readonly EventTarget[],
  deltaX: number,
): boolean {
  for (const target of path) {
    if (!(target instanceof HTMLElement)) continue;
    const style = getComputedStyle(target);
    const overflowX =
      target === document.scrollingElement && style.overflowX === "visible"
        ? "auto"
        : style.overflowX;
    if (
      horizontalScrollContainerOwnsDelta(
        {
          scrollLeft: target.scrollLeft,
          scrollWidth: target.scrollWidth,
          clientWidth: target.clientWidth,
          direction: style.direction,
          overflowX,
          overscrollBehaviorX: style.overscrollBehaviorX,
        },
        deltaX,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function makeHistoryGestureEventController(input: {
  readonly navigate: (direction: HistoryGestureDirection) => void;
  readonly now?: () => number;
  readonly horizontalScrollerConsumesDelta?: (event: WheelEvent) => boolean;
}): HistoryGestureEventController {
  let wheelState: HorizontalWheelGestureState = INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE;
  let wheelTransactionOwner: "idle" | "pending" | "history" | "content" = "idle";
  let lastWheelEventAt = Number.NEGATIVE_INFINITY;
  let lastSideButton: { readonly button: number; readonly at: number } | null = null;
  const now = input.now ?? (() => performance.now());

  const handleSideButton = (event: MouseEvent, source: "mousedown" | "auxclick") => {
    if (!event.isTrusted) return;
    const direction = historyDirectionFromMouseButton(event.button);
    if (direction === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const at = now();
    if (
      source === "auxclick" &&
      lastSideButton?.button === event.button &&
      at - lastSideButton.at < 500
    ) {
      lastSideButton = null;
      return;
    }
    lastSideButton = source === "mousedown" ? { button: event.button, at } : null;
    input.navigate(direction);
  };

  return {
    handleMouseDown: (event) => handleSideButton(event, "mousedown"),
    handleMouseUp: (event) => {
      if (!event.isTrusted || historyDirectionFromMouseButton(event.button) === null) return;
      // Chromium applies thumb-button history on release. The explicit
      // mousedown route above already owns the action, so consume mouseup too
      // before it can navigate whichever WebContents currently has focus.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    handleAuxClick: (event) => handleSideButton(event, "auxclick"),
    handleWheel: (event) => {
      if (!event.isTrusted || event.ctrlKey || event.shiftKey || event.deltaMode !== 0) {
        return;
      }
      if (event.timeStamp - lastWheelEventAt > HORIZONTAL_WHEEL_GESTURE_RESET_MS) {
        wheelTransactionOwner = "idle";
        wheelState = INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE;
      }
      lastWheelEventAt = event.timeStamp;
      if (wheelTransactionOwner === "content") return;
      const horizontallyDominant =
        Number.isFinite(event.deltaX) &&
        Number.isFinite(event.deltaY) &&
        event.deltaX !== 0 &&
        Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.25;
      if (!horizontallyDominant) {
        const verticallyDominant =
          Number.isFinite(event.deltaX) &&
          Number.isFinite(event.deltaY) &&
          event.deltaY !== 0 &&
          Math.abs(event.deltaY) > Math.abs(event.deltaX) * 1.25;
        if (verticallyDominant && wheelTransactionOwner !== "history") {
          wheelTransactionOwner = "content";
          wheelState = INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE;
          return;
        }
        if (wheelTransactionOwner === "idle") {
          if (!event.cancelable) {
            wheelTransactionOwner = "content";
            return;
          }
          wheelTransactionOwner = "pending";
        }
        wheelState = reduceHorizontalWheelGesture(wheelState, event).state;
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (wheelTransactionOwner === "idle" || wheelTransactionOwner === "pending") {
        // Chromium may expose only the first wheel event in a transaction as
        // cancelable. Claim that first event, then keep accumulating its
        // non-cancelable continuation until the transaction goes idle.
        if (wheelTransactionOwner === "idle" && !event.cancelable) {
          wheelTransactionOwner = "content";
          wheelState = INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE;
          return;
        }
        const scrollerConsumesDelta = input.horizontalScrollerConsumesDelta
          ? input.horizontalScrollerConsumesDelta(event)
          : horizontalScrollableDomPathConsumesDelta(event.composedPath(), event.deltaX);
        if (scrollerConsumesDelta) {
          wheelTransactionOwner = "content";
          wheelState = INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE;
          return;
        }
        wheelTransactionOwner = "pending";
      }
      const result = reduceHorizontalWheelGesture(wheelState, event);
      wheelState = result.state;
      if (event.cancelable) event.preventDefault();
      if (result.direction !== null) {
        wheelTransactionOwner = "history";
        input.navigate(result.direction);
      }
    },
  };
}
