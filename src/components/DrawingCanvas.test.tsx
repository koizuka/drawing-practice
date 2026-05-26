import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingCanvas } from './DrawingCanvas';
import { StrokeManager } from '../drawing/StrokeManager';
import type { GridSettings } from '../guides/types';

const grid: GridSettings = { mode: 'none' };

const CANVAS_RECT: DOMRect = {
  left: 0,
  top: 0,
  right: 400,
  bottom: 300,
  width: 400,
  height: 300,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

let originalResizeObserver: typeof globalThis.ResizeObserver;

function touch(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY, touchType: 'stylus' } as Touch & { touchType: string };
}

function renderCanvas(strokeManager = new StrokeManager()) {
  const onStrokeCountChange = vi.fn();
  const view = render(
    <DrawingCanvas
      mode="pen"
      highlightedStrokeIndex={null}
      onHighlightStroke={vi.fn()}
      onStrokeCountChange={onStrokeCountChange}
      strokeManager={strokeManager}
      redrawVersion={0}
      viewResetVersion={0}
      grid={grid}
      guideLines={[]}
      guideVersion={0}
    />,
  );
  return {
    ...view,
    canvas: view.container.querySelector('canvas')!,
    onStrokeCountChange,
    strokeManager,
  };
}

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);
  globalThis.ResizeObserver = class ResizeObserver {
    private cb: ResizeObserverCallback;

    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }

    observe(target: Element) {
      this.cb([{ target, contentRect: CANVAS_RECT } as ResizeObserverEntry], this);
    }

    unobserve() {}
    disconnect() {}
  } as typeof globalThis.ResizeObserver;
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

describe('DrawingCanvas touch recovery', () => {
  it('drops stale active touches on the next touchstart so Pencil strokes do not get stuck as pinch gestures', () => {
    const { canvas, strokeManager, onStrokeCountChange } = renderCanvas();

    // Start a Pencil stroke, then simulate iOS Safari losing the matching
    // touchend/touchcancel. The old touch id remains only in app state.
    fireEvent.touchStart(canvas, {
      touches: [touch(1, 20, 20)],
      changedTouches: [touch(1, 20, 20)],
    });
    fireEvent.touchMove(canvas, {
      touches: [touch(1, 30, 30)],
      changedTouches: [touch(1, 30, 30)],
    });

    // The next touchstart's `touches` list contains only the new live Pencil
    // contact. Rebuilding from that list must discard the stale id; otherwise
    // this would arm pinch mode and never commit a stroke.
    fireEvent.touchStart(canvas, {
      touches: [touch(2, 80, 80)],
      changedTouches: [touch(2, 80, 80)],
    });
    fireEvent.touchMove(canvas, {
      touches: [touch(2, 110, 110)],
      changedTouches: [touch(2, 110, 110)],
    });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(2, 110, 110)],
    });

    expect(strokeManager.getStrokes()).toHaveLength(1);
    expect(onStrokeCountChange).toHaveBeenCalledTimes(1);
  });

  it('clears an in-flight touch session on page blur', () => {
    const { canvas, strokeManager } = renderCanvas();

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 20, 20)],
      changedTouches: [touch(1, 20, 20)],
    });
    fireEvent.touchMove(canvas, {
      touches: [touch(1, 30, 30)],
      changedTouches: [touch(1, 30, 30)],
    });

    window.dispatchEvent(new Event('blur'));

    expect(strokeManager.getCurrentStroke()).toBeNull();
  });

  it('clears stale pinch state when the next touchstart has only one live touch', () => {
    const { canvas, strokeManager, onStrokeCountChange } = renderCanvas();

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 20, 20), touch(2, 80, 80)],
      changedTouches: [touch(1, 20, 20), touch(2, 80, 80)],
    });
    fireEvent.touchMove(canvas, {
      touches: [touch(1, 15, 15), touch(2, 85, 85)],
      changedTouches: [touch(1, 15, 15), touch(2, 85, 85)],
    });

    // Simulate Safari losing the touchend/touchcancel for the pinch. The next
    // Pencil contact reports a single live touch, so stale pinch ids must be
    // cleared before moves are handled.
    fireEvent.touchStart(canvas, {
      touches: [touch(3, 120, 120)],
      changedTouches: [touch(3, 120, 120)],
    });
    fireEvent.touchMove(canvas, {
      touches: [touch(3, 150, 150)],
      changedTouches: [touch(3, 150, 150)],
    });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(3, 150, 150)],
    });

    expect(strokeManager.getStrokes()).toHaveLength(1);
    expect(onStrokeCountChange).toHaveBeenCalledTimes(1);
  });
});
