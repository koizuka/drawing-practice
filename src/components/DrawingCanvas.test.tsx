import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingCanvas, type DrawingMode } from './DrawingCanvas';
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

interface RenderOpts {
  mode?: DrawingMode;
  highlightedStrokeIndex?: number | null;
}

function renderCanvas(strokeManager = new StrokeManager(), opts: RenderOpts = {}) {
  const onStrokeCountChange = vi.fn();
  const onHighlightStroke = vi.fn();
  const onDeleteHighlightedStroke = vi.fn();
  const view = render(
    <DrawingCanvas
      mode={opts.mode ?? 'pen'}
      highlightedStrokeIndex={opts.highlightedStrokeIndex ?? null}
      onHighlightStroke={onHighlightStroke}
      onDeleteHighlightedStroke={onDeleteHighlightedStroke}
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
    onHighlightStroke,
    onDeleteHighlightedStroke,
    strokeManager,
  };
}

// Commit a stroke directly into the manager so erase-mode tests have a target.
// CANVAS_RECT is 400×300 with no fitSize, so baseScale = 1, zoom = 1 and the
// screen→world mapping is world = (clientX - 200, clientY - 150) (container
// center is grid origin). A stroke at world (0,0) therefore sits under a tap
// at client (200, 150).
function addStrokeAt(sm: StrokeManager, x: number, y: number) {
  sm.startStroke({ x, y });
  sm.appendStroke({ x: x + 5, y: y + 5 });
  sm.endStroke();
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

describe('DrawingCanvas erase mode (unified tap-select / drag-lasso)', () => {
  it('tap (no movement) highlights the nearest stroke', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0); // under client (200, 150)
    const { canvas, onHighlightStroke } = renderCanvas(sm, { mode: 'erase' });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(1, 200, 150)],
    });

    expect(onHighlightStroke).toHaveBeenCalledWith(0);
    expect(sm.getStrokes()).toHaveLength(1); // tap only selects, doesn't delete
  });

  it('re-tapping the already-highlighted stroke deletes it', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    const { canvas, onDeleteHighlightedStroke } = renderCanvas(sm, {
      mode: 'erase',
      highlightedStrokeIndex: 0,
    });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(1, 200, 150)],
    });

    expect(onDeleteHighlightedStroke).toHaveBeenCalledOnce();
  });

  it('drag enclosing a stroke promotes to a lasso and deletes it immediately', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0); // world (0,0)/(5,5) — inside the rectangle drawn below
    const lassoDelete = vi.spyOn(sm, 'lassoDelete');
    const { canvas, onHighlightStroke } = renderCanvas(sm, { mode: 'erase' });

    // Start far from the target, then trace a rectangle enclosing it. The
    // first move (>8px) promotes the pending press to a lasso.
    fireEvent.touchStart(canvas, {
      touches: [touch(1, 100, 100)],
      changedTouches: [touch(1, 100, 100)],
    });
    for (const [x, y] of [[300, 100], [300, 200], [100, 200], [100, 100]]) {
      fireEvent.touchMove(canvas, {
        touches: [touch(1, x, y)],
        changedTouches: [touch(1, x, y)],
      });
    }
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(1, 100, 100)],
    });

    expect(lassoDelete).toHaveBeenCalledOnce();
    expect(lassoDelete).toHaveBeenCalledWith([0]);
    expect(onHighlightStroke).not.toHaveBeenCalled(); // never resolved as a tap
    expect(sm.getStrokes()).toHaveLength(0);
  });

  it('starting a lasso clears a pending tap-highlight candidate', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    // A previous tap left stroke 0 highlighted (Delete/Cancel showing).
    const { canvas, onHighlightStroke } = renderCanvas(sm, {
      mode: 'erase',
      highlightedStrokeIndex: 0,
    });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 100, 100)],
      changedTouches: [touch(1, 100, 100)],
    });
    // First move crosses the threshold → promotes to a lasso.
    fireEvent.touchMove(canvas, {
      touches: [touch(1, 300, 100)],
      changedTouches: [touch(1, 300, 100)],
    });

    // The highlight is cleared on promotion, before the lasso even closes.
    expect(onHighlightStroke).toHaveBeenCalledWith(null);
  });

  it('movement below the threshold stays a tap; above it becomes a lasso', () => {
    // 7px → tap-select
    {
      const sm = new StrokeManager();
      addStrokeAt(sm, 0, 0);
      const { canvas, onHighlightStroke } = renderCanvas(sm, { mode: 'erase' });
      fireEvent.touchStart(canvas, {
        touches: [touch(1, 200, 150)],
        changedTouches: [touch(1, 200, 150)],
      });
      fireEvent.touchMove(canvas, {
        touches: [touch(1, 207, 150)],
        changedTouches: [touch(1, 207, 150)],
      });
      fireEvent.touchEnd(canvas, {
        touches: [],
        changedTouches: [touch(1, 207, 150)],
      });
      expect(onHighlightStroke).toHaveBeenCalledWith(0);
    }

    // 9px → lasso (here the 2-point path encloses nothing, so nothing is
    // deleted — but it must NOT fall back to tap-select).
    {
      const sm = new StrokeManager();
      addStrokeAt(sm, 0, 0);
      const lassoDelete = vi.spyOn(sm, 'lassoDelete');
      const { canvas, onHighlightStroke } = renderCanvas(sm, { mode: 'erase' });
      fireEvent.touchStart(canvas, {
        touches: [touch(1, 200, 150)],
        changedTouches: [touch(1, 200, 150)],
      });
      fireEvent.touchMove(canvas, {
        touches: [touch(1, 209, 150)],
        changedTouches: [touch(1, 209, 150)],
      });
      fireEvent.touchEnd(canvas, {
        touches: [],
        changedTouches: [touch(1, 209, 150)],
      });
      expect(onHighlightStroke).not.toHaveBeenCalled();
      expect(lassoDelete).not.toHaveBeenCalled(); // degenerate 2-point lasso
    }
  });

  it('a second finger during a pending erase press cancels it (pinch wins)', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    const lassoDelete = vi.spyOn(sm, 'lassoDelete');
    const { canvas, onHighlightStroke, onDeleteHighlightedStroke } = renderCanvas(sm, { mode: 'erase' });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    // Second finger arms pinch and drops the pending press.
    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150), touch(2, 260, 150)],
      changedTouches: [touch(2, 260, 150)],
    });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [touch(1, 200, 150), touch(2, 260, 150)],
    });

    expect(onHighlightStroke).not.toHaveBeenCalled();
    expect(onDeleteHighlightedStroke).not.toHaveBeenCalled();
    expect(lassoDelete).not.toHaveBeenCalled();
  });

  it('touchcancel discards a pending erase press instead of resolving it as a tap/delete', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    const lassoDelete = vi.spyOn(sm, 'lassoDelete');
    // Stroke 0 is already highlighted — a resolved tap here would DELETE it.
    const { canvas, onHighlightStroke, onDeleteHighlightedStroke } = renderCanvas(sm, {
      mode: 'erase',
      highlightedStrokeIndex: 0,
    });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    // System cancels the touch (palm rejection / OS gesture).
    fireEvent.touchCancel(canvas, {
      touches: [],
      changedTouches: [touch(1, 200, 150)],
    });

    expect(onDeleteHighlightedStroke).not.toHaveBeenCalled();
    expect(onHighlightStroke).not.toHaveBeenCalled();
    expect(lassoDelete).not.toHaveBeenCalled();
    expect(sm.getStrokes()).toHaveLength(1);
  });

  it('touchcancel discards a promoted lasso instead of deleting the enclosed strokes', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    const lassoDelete = vi.spyOn(sm, 'lassoDelete');
    const { canvas } = renderCanvas(sm, { mode: 'erase' });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 100, 100)],
      changedTouches: [touch(1, 100, 100)],
    });
    for (const [x, y] of [[300, 100], [300, 200], [100, 200], [100, 100]]) {
      fireEvent.touchMove(canvas, {
        touches: [touch(1, x, y)],
        changedTouches: [touch(1, x, y)],
      });
    }
    // Cancel mid-lasso: the enclosed stroke must survive.
    fireEvent.touchCancel(canvas, {
      touches: [],
      changedTouches: [touch(1, 100, 100)],
    });

    expect(lassoDelete).not.toHaveBeenCalled();
    expect(sm.getStrokes()).toHaveLength(1);
  });

  it('mouse: click selects, drag-enclose deletes via lasso', () => {
    // Click (no movement) → highlight
    {
      const sm = new StrokeManager();
      addStrokeAt(sm, 0, 0);
      const { canvas, onHighlightStroke } = renderCanvas(sm, { mode: 'erase' });
      fireEvent.mouseDown(canvas, { clientX: 200, clientY: 150 });
      fireEvent.mouseUp(canvas, { clientX: 200, clientY: 150 });
      expect(onHighlightStroke).toHaveBeenCalledWith(0);
    }

    // Drag enclosing the stroke → lasso delete
    {
      const sm = new StrokeManager();
      addStrokeAt(sm, 0, 0);
      const lassoDelete = vi.spyOn(sm, 'lassoDelete');
      const { canvas } = renderCanvas(sm, { mode: 'erase' });
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      for (const [x, y] of [[300, 100], [300, 200], [100, 200], [100, 100]]) {
        fireEvent.mouseMove(canvas, { clientX: x, clientY: y });
      }
      fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });
      expect(lassoDelete).toHaveBeenCalledWith([0]);
    }
  });
});

// With passive touch listeners we no longer preventDefault, so iOS emits
// compatibility ("synthetic") mouse events after a touch. Before any stylus
// contact hasStylusRef is false, so without a guard those would re-enter the
// mouse handlers and double up the stroke a finger touch already drew.
describe('DrawingCanvas synthetic-mouse suppression after touch', () => {
  function finger(identifier: number, clientX: number, clientY: number): Touch {
    return { identifier, clientX, clientY, touchType: 'direct' } as Touch & { touchType: string };
  }

  it('ignores the mouse events that follow a finger touch (no second stroke)', () => {
    const sm = new StrokeManager();
    const { canvas } = renderCanvas(sm); // pen mode, no prior stylus

    fireEvent.touchStart(canvas, { touches: [finger(1, 50, 50)], changedTouches: [finger(1, 50, 50)] });
    fireEvent.touchMove(canvas, { touches: [finger(1, 70, 80)], changedTouches: [finger(1, 70, 80)] });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [finger(1, 70, 80)] });
    expect(sm.getStrokes()).toHaveLength(1);

    // Synthetic mouse events immediately after the touch must not draw again.
    fireEvent.mouseDown(canvas, { clientX: 70, clientY: 80 });
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 90, clientY: 100 });
    expect(sm.getStrokes()).toHaveLength(1);
  });

  it('still draws with a real mouse when no touch preceded it', () => {
    const sm = new StrokeManager();
    const { canvas } = renderCanvas(sm);

    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(canvas, { clientX: 70, clientY: 80 });
    fireEvent.mouseUp(canvas, { clientX: 70, clientY: 80 });
    expect(sm.getStrokes()).toHaveLength(1);
  });
});
