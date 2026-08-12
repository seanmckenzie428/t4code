export type HistoryGestureDirection = "back" | "forward";

export interface HorizontalWheelGestureInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly timeStamp: number;
}

export interface HorizontalWheelGestureState {
  readonly accumulatedX: number;
  readonly lastEventAt: number;
  readonly triggered: boolean;
}

export interface HorizontalWheelGestureResult {
  readonly state: HorizontalWheelGestureState;
  readonly direction: HistoryGestureDirection | null;
}

export const INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE: HorizontalWheelGestureState = {
  accumulatedX: 0,
  lastEventAt: Number.NEGATIVE_INFINITY,
  triggered: false,
};

export const HORIZONTAL_WHEEL_GESTURE_RESET_MS = 160;
const HORIZONTAL_WHEEL_GESTURE_THRESHOLD_PX = 90;
const HORIZONTAL_DOMINANCE_RATIO = 1.25;

export function historyDirectionFromMouseButton(button: number): HistoryGestureDirection | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

export function reduceHorizontalWheelGesture(
  previous: HorizontalWheelGestureState,
  input: HorizontalWheelGestureInput,
): HorizontalWheelGestureResult {
  const scale = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 800 : 1;
  const deltaX = input.deltaX * scale;
  const deltaY = input.deltaY * scale;
  const newGesture = input.timeStamp - previous.lastEventAt > HORIZONTAL_WHEEL_GESTURE_RESET_MS;
  const state = newGesture ? INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE : previous;

  // Momentum tails may change axis after the threshold. Once a gesture owns
  // history, keep it owned until idle instead of allowing a second action.
  if (state.triggered) {
    return {
      state: { ...state, lastEventAt: input.timeStamp },
      direction: null,
    };
  }

  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    deltaX === 0 ||
    Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_DOMINANCE_RATIO
  ) {
    return {
      state: { accumulatedX: 0, lastEventAt: input.timeStamp, triggered: false },
      direction: null,
    };
  }

  const accumulatedX =
    state.accumulatedX !== 0 && Math.sign(state.accumulatedX) !== Math.sign(deltaX)
      ? deltaX
      : state.accumulatedX + deltaX;
  const direction =
    Math.abs(accumulatedX) >= HORIZONTAL_WHEEL_GESTURE_THRESHOLD_PX
      ? accumulatedX > 0
        ? "forward"
        : "back"
      : null;

  return {
    state: { accumulatedX, lastEventAt: input.timeStamp, triggered: direction !== null },
    direction,
  };
}

export interface HorizontalScrollState {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

export interface HorizontalScrollContainerState extends HorizontalScrollState {
  readonly direction: string;
  readonly overflowX: string;
  readonly overscrollBehaviorX: string;
}

export function horizontalScrollConsumesDelta(
  state: HorizontalScrollState,
  deltaX: number,
): boolean {
  if (deltaX === 0 || state.scrollWidth <= state.clientWidth) return false;
  const maximumScrollLeft = Math.max(0, state.scrollWidth - state.clientWidth);
  if (deltaX < 0) return state.scrollLeft > 0;
  return state.scrollLeft < maximumScrollLeft - 1;
}

export function horizontalScrollContainerOwnsDelta(
  state: HorizontalScrollContainerState,
  deltaX: number,
): boolean {
  const permitsHorizontalScroll =
    state.overflowX === "auto" || state.overflowX === "scroll" || state.overflowX === "overlay";
  if (!permitsHorizontalScroll || state.scrollWidth <= state.clientWidth) return false;
  // Chromium uses negative scrollLeft for RTL. Conservatively leave the whole
  // gesture with the scroller instead of risking history at the wrong edge.
  if (state.direction === "rtl") return true;
  if (horizontalScrollConsumesDelta(state, deltaX)) return true;
  return state.overscrollBehaviorX === "contain" || state.overscrollBehaviorX === "none";
}
