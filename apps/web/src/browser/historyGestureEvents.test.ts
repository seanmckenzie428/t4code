import { describe, expect, it, vi } from "vite-plus/test";

import {
  horizontalScrollableDomPathConsumesDelta,
  makeHistoryGestureEventController,
} from "./historyGestureEvents";

class FakeHtmlElement {
  readonly scrollLeft = 20;
  readonly scrollWidth = 400;
  readonly clientWidth = 200;
}

function trustedMouseEvent(button: number) {
  return {
    button,
    isTrusted: true,
    cancelable: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as MouseEvent;
}

function trustedWheelEvent(input: {
  readonly deltaX: number;
  readonly deltaY?: number;
  readonly timeStamp: number;
}) {
  return {
    deltaX: input.deltaX,
    deltaY: input.deltaY ?? 0,
    deltaMode: 0,
    timeStamp: input.timeStamp,
    ctrlKey: false,
    shiftKey: false,
    isTrusted: true,
    cancelable: true,
    target: null,
    composedPath: () => [],
    preventDefault: vi.fn(),
  } as unknown as WheelEvent;
}

function untrustedMouseEvent(button: number) {
  return {
    ...trustedMouseEvent(button),
    isTrusted: false,
  } as unknown as MouseEvent;
}

describe("history gesture DOM events", () => {
  it("finds a horizontal scroller through an SVG composed path", () => {
    vi.stubGlobal("HTMLElement", FakeHtmlElement);
    vi.stubGlobal("document", { scrollingElement: null });
    vi.stubGlobal("getComputedStyle", () => ({
      direction: "ltr",
      overflowX: "auto",
      overscrollBehaviorX: "auto",
    }));

    try {
      const svg = {} as EventTarget;
      const scroller = new FakeHtmlElement() as unknown as EventTarget;
      expect(horizontalScrollableDomPathConsumesDelta([svg, scroller], -20)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deduplicates mousedown and auxclick for one side-button press", () => {
    const navigate = vi.fn();
    let now = 100;
    const controller = makeHistoryGestureEventController({ navigate, now: () => now });
    const down = trustedMouseEvent(3);
    const click = trustedMouseEvent(3);

    controller.handleMouseDown(down);
    now = 120;
    controller.handleAuxClick(click);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("back");
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(click.preventDefault).toHaveBeenCalledOnce();
  });

  it("cancels from the first horizontal wheel event and navigates once", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const first = trustedWheelEvent({ deltaX: 50, timeStamp: 10 });
    const second = trustedWheelEvent({ deltaX: 50, timeStamp: 20 });
    const momentum = trustedWheelEvent({ deltaX: 100, timeStamp: 30 });

    controller.handleWheel(first);
    controller.handleWheel(second);
    controller.handleWheel(momentum);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("forward");
  });

  it("keeps later diagonal momentum inside an owned history transaction", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const first = trustedWheelEvent({ deltaX: 100, timeStamp: 10 });
    const diagonal = trustedWheelEvent({ deltaX: 10, deltaY: 20, timeStamp: 20 });
    const momentum = trustedWheelEvent({ deltaX: 100, timeStamp: 30 });

    controller.handleWheel(first);
    controller.handleWheel(diagonal);
    controller.handleWheel(momentum);

    expect(diagonal.preventDefault).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("keeps accumulating after Chromium makes the owned transaction uncancelable", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const first = trustedWheelEvent({ deltaX: 50, timeStamp: 10 });
    const second = {
      ...trustedWheelEvent({ deltaX: 50, timeStamp: 20 }),
      cancelable: false,
    };

    controller.handleWheel(first);
    controller.handleWheel(second as WheelEvent);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("forward");
  });

  it("reserves ambiguous startup until an uncancelable continuation becomes horizontal", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const startup = trustedWheelEvent({ deltaX: 1, deltaY: 1, timeStamp: 10 });
    const continuation = {
      ...trustedWheelEvent({ deltaX: -100, timeStamp: 20 }),
      cancelable: false,
    };

    controller.handleWheel(startup);
    controller.handleWheel(continuation as WheelEvent);

    expect(startup.preventDefault).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("back");
  });

  it("hands a pending ambiguous gesture to content once it becomes vertical", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const startup = trustedWheelEvent({ deltaX: 1, deltaY: 1, timeStamp: 10 });
    const continuation = trustedWheelEvent({ deltaX: 1, deltaY: 100, timeStamp: 20 });

    controller.handleWheel(startup);
    controller.handleWheel(continuation);

    expect(startup.preventDefault).toHaveBeenCalledOnce();
    expect(continuation.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hands a sub-threshold horizontal start to content when it becomes vertical", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const startup = trustedWheelEvent({ deltaX: 20, deltaY: 1, timeStamp: 10 });
    const continuation = trustedWheelEvent({ deltaX: 1, deltaY: 100, timeStamp: 20 });

    controller.handleWheel(startup);
    controller.handleWheel(continuation);

    expect(startup.preventDefault).toHaveBeenCalledOnce();
    expect(continuation.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not deduplicate separate auxclick-only presses", () => {
    const navigate = vi.fn();
    let now = 100;
    const controller = makeHistoryGestureEventController({ navigate, now: () => now });
    controller.handleAuxClick(trustedMouseEvent(4));
    now = 120;
    controller.handleAuxClick(trustedMouseEvent(4));
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("ignores untrusted side buttons", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    controller.handleMouseDown(untrustedMouseEvent(3));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("preserves a horizontal scroller instead of navigating", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({
      navigate,
      horizontalScrollerConsumesDelta: () => true,
    });
    const event = trustedWheelEvent({ deltaX: 100, timeStamp: 10 });
    controller.handleWheel(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the whole wheel transaction with its horizontal scroller", () => {
    const navigate = vi.fn();
    const horizontalScrollerConsumesDelta = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const controller = makeHistoryGestureEventController({
      navigate,
      horizontalScrollerConsumesDelta,
    });
    const first = trustedWheelEvent({ deltaX: 100, timeStamp: 10 });
    const edgeMomentum = trustedWheelEvent({ deltaX: 100, timeStamp: 20 });

    controller.handleWheel(first);
    controller.handleWheel(edgeMomentum);

    expect(horizontalScrollerConsumesDelta).toHaveBeenCalledOnce();
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(edgeMomentum.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves uncancelable wheel transactions to Chromium", () => {
    const navigate = vi.fn();
    const controller = makeHistoryGestureEventController({ navigate });
    const event = { ...trustedWheelEvent({ deltaX: 100, timeStamp: 10 }), cancelable: false };
    controller.handleWheel(event as WheelEvent);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
