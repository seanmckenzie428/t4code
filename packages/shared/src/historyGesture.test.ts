import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE,
  historyDirectionFromMouseButton,
  horizontalScrollConsumesDelta,
  horizontalScrollContainerOwnsDelta,
  reduceHorizontalWheelGesture,
} from "./historyGesture.ts";

describe("horizontal history gestures", () => {
  it("maps only browser side buttons", () => {
    expect(historyDirectionFromMouseButton(3)).toBe("back");
    expect(historyDirectionFromMouseButton(4)).toBe("forward");
    expect(historyDirectionFromMouseButton(1)).toBeNull();
  });

  it("emits one direction after a dominant horizontal threshold", () => {
    const first = reduceHorizontalWheelGesture(INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE, {
      deltaX: 50,
      deltaY: 5,
      deltaMode: 0,
      timeStamp: 10,
    });
    expect(first.direction).toBeNull();
    const second = reduceHorizontalWheelGesture(first.state, {
      deltaX: 45,
      deltaY: 3,
      deltaMode: 0,
      timeStamp: 30,
    });
    expect(second.direction).toBe("forward");
    expect(
      reduceHorizontalWheelGesture(second.state, {
        deltaX: 100,
        deltaY: 0,
        deltaMode: 0,
        timeStamp: 50,
      }).direction,
    ).toBeNull();
  });

  it("resets after idle and maps the opposite direction to back", () => {
    const forward = reduceHorizontalWheelGesture(INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE, {
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      timeStamp: 10,
    });
    const back = reduceHorizontalWheelGesture(forward.state, {
      deltaX: -100,
      deltaY: 0,
      deltaMode: 0,
      timeStamp: 200,
    });
    expect(back.direction).toBe("back");
  });

  it("stays one-shot through a diagonal momentum tail", () => {
    const triggered = reduceHorizontalWheelGesture(INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE, {
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      timeStamp: 10,
    });
    const diagonal = reduceHorizontalWheelGesture(triggered.state, {
      deltaX: 10,
      deltaY: 20,
      deltaMode: 0,
      timeStamp: 30,
    });
    const tail = reduceHorizontalWheelGesture(diagonal.state, {
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      timeStamp: 50,
    });
    expect(diagonal.direction).toBeNull();
    expect(diagonal.state.triggered).toBe(true);
    expect(tail.direction).toBeNull();
  });

  it("rejects vertical and diagonal scrolling", () => {
    expect(
      reduceHorizontalWheelGesture(INITIAL_HORIZONTAL_WHEEL_GESTURE_STATE, {
        deltaX: 90,
        deltaY: 90,
        deltaMode: 0,
        timeStamp: 10,
      }).direction,
    ).toBeNull();
  });

  it("preserves a horizontal scroller until it reaches the relevant edge", () => {
    expect(
      horizontalScrollConsumesDelta({ scrollLeft: 25, scrollWidth: 400, clientWidth: 200 }, -20),
    ).toBe(true);
    expect(
      horizontalScrollConsumesDelta({ scrollLeft: 0, scrollWidth: 400, clientWidth: 200 }, -20),
    ).toBe(false);
    expect(
      horizontalScrollConsumesDelta({ scrollLeft: 100, scrollWidth: 400, clientWidth: 200 }, 20),
    ).toBe(true);
    expect(
      horizontalScrollConsumesDelta({ scrollLeft: 200, scrollWidth: 400, clientWidth: 200 }, 20),
    ).toBe(false);
  });

  it("ignores clipped overflow and conservatively preserves RTL scrollers", () => {
    const base = {
      scrollLeft: 0,
      scrollWidth: 400,
      clientWidth: 200,
      direction: "ltr",
      overflowX: "hidden",
      overscrollBehaviorX: "auto",
    };
    expect(horizontalScrollContainerOwnsDelta(base, 20)).toBe(false);
    expect(
      horizontalScrollContainerOwnsDelta({ ...base, direction: "rtl", overflowX: "auto" }, 20),
    ).toBe(true);
    expect(
      horizontalScrollContainerOwnsDelta(
        { ...base, overflowX: "auto", overscrollBehaviorX: "contain" },
        -20,
      ),
    ).toBe(true);
  });
});
