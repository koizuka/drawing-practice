import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingCanvas, UNDERLAY_ALPHA, type DrawingMode } from './DrawingCanvas';
import { StrokeManager } from '../drawing/StrokeManager';
import { ViewTransform } from '../drawing/ViewTransform';
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
  placingPerspectiveCenter?: boolean;
}

function renderCanvas(strokeManager = new StrokeManager(), opts: RenderOpts = {}) {
  const onStrokeCountChange = vi.fn();
  const onHighlightStroke = vi.fn();
  const onDeleteHighlightedStroke = vi.fn();
  const onPlacePerspectiveCenter = vi.fn();
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
      placingPerspectiveCenter={opts.placingPerspectiveCenter ?? false}
      onPlacePerspectiveCenter={onPlacePerspectiveCenter}
    />,
  );
  return {
    ...view,
    canvas: view.container.querySelector('canvas')!,
    onStrokeCountChange,
    onHighlightStroke,
    onDeleteHighlightedStroke,
    onPlacePerspectiveCenter,
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
    for (const [x, y] of [
      [300, 100],
      [300, 200],
      [100, 200],
      [100, 100],
    ]) {
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
    const { canvas, onHighlightStroke, onDeleteHighlightedStroke } = renderCanvas(sm, {
      mode: 'erase',
    });

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
    for (const [x, y] of [
      [300, 100],
      [300, 200],
      [100, 200],
      [100, 100],
    ]) {
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
      for (const [x, y] of [
        [300, 100],
        [300, 200],
        [100, 200],
        [100, 100],
      ]) {
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

    fireEvent.touchStart(canvas, {
      touches: [finger(1, 50, 50)],
      changedTouches: [finger(1, 50, 50)],
    });
    fireEvent.touchMove(canvas, {
      touches: [finger(1, 70, 80)],
      changedTouches: [finger(1, 70, 80)],
    });
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

describe('DrawingCanvas perspective-anchor placement', () => {
  it('routes a pen-mode tap to onPlacePerspectiveCenter without starting a stroke', () => {
    const sm = new StrokeManager();
    const { canvas, onPlacePerspectiveCenter } = renderCanvas(sm, {
      placingPerspectiveCenter: true,
    });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [touch(1, 200, 150)] });

    // Container center maps to world origin (see addStrokeAt comment).
    expect(onPlacePerspectiveCenter).toHaveBeenCalledWith(0, 0);
    expect(sm.getStrokes()).toHaveLength(0);
    expect(sm.getCurrentStroke()).toBeNull();
  });

  it('routes an erase-mode tap to onPlacePerspectiveCenter without erasing', () => {
    const sm = new StrokeManager();
    addStrokeAt(sm, 0, 0);
    const { canvas, onPlacePerspectiveCenter } = renderCanvas(sm, {
      mode: 'erase',
      placingPerspectiveCenter: true,
    });

    fireEvent.touchStart(canvas, {
      touches: [touch(1, 200, 150)],
      changedTouches: [touch(1, 200, 150)],
    });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [touch(1, 200, 150)] });

    expect(onPlacePerspectiveCenter).toHaveBeenCalledWith(0, 0);
    expect(sm.getStrokes()).toHaveLength(1);
  });

  it('routes a mouse click to onPlacePerspectiveCenter without drawing', () => {
    const sm = new StrokeManager();
    const { canvas, onPlacePerspectiveCenter } = renderCanvas(sm, {
      placingPerspectiveCenter: true,
    });

    fireEvent.mouseDown(canvas, { clientX: 250, clientY: 150 });
    fireEvent.mouseMove(canvas, { clientX: 260, clientY: 160 });
    fireEvent.mouseUp(canvas, { clientX: 260, clientY: 160 });

    expect(onPlacePerspectiveCenter).toHaveBeenCalledWith(50, 0);
    expect(sm.getStrokes()).toHaveLength(0);
  });
});

describe('DrawingCanvas reference underlay', () => {
  // Fake Image: fires onload on a microtask after `src` is set, with a fixed
  // natural size. jsdom never loads images, so this stands in for both the
  // plain and the CORS-upgrade loads in loadReferenceImage.
  class FakeImage {
    naturalWidth = 200;
    naturalHeight = 100;
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    get src() {
      return this._src;
    }
    set src(v: string) {
      this._src = v;
      queueMicrotask(() => this.onload?.());
    }
  }

  interface Call {
    name: string;
    args: unknown[];
    globalAlpha: number;
    fillStyle: unknown;
  }

  // Recording 2D context: remembers every method call together with the
  // globalAlpha / fillStyle in effect at call time (save/restore honoured).
  function installRecordingContext(): Call[] {
    const calls: Call[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '#000' };
    const stack: Record<string, unknown>[] = [];
    const ctx = new Proxy(state, {
      get(target, prop: string) {
        if (prop === 'canvas') return { width: 400, height: 300 };
        if (prop in target) return target[prop];
        return (...args: unknown[]) => {
          if (prop === 'save') stack.push({ ...state });
          if (prop === 'restore') Object.assign(state, stack.pop() ?? {});
          calls.push({
            name: prop,
            args,
            globalAlpha: state.globalAlpha as number,
            fillStyle: state.fillStyle,
          });
          return prop === 'measureText' ? { width: 0 } : undefined;
        };
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    return calls;
  }

  const MASKS = [
    { id: 'mask-1', x: -50, y: -20, w: 30, h: 40 },
    { id: 'mask-2', x: 10, y: 5, w: 20, h: 10 },
  ];

  function renderUnderlay(props: {
    underlayEnabled: boolean;
    masksHidden?: boolean;
    masks?: typeof MASKS;
  }) {
    return render(
      <DrawingCanvas
        mode="pen"
        highlightedStrokeIndex={null}
        onHighlightStroke={vi.fn()}
        onStrokeCountChange={vi.fn()}
        strokeManager={new StrokeManager()}
        redrawVersion={0}
        viewResetVersion={0}
        grid={grid}
        guideLines={[]}
        guideVersion={0}
        underlayImageUrl="https://example.com/ref.png"
        underlayEnabled={props.underlayEnabled}
        masks={props.masks ?? []}
        masksHidden={props.masksHidden ?? true}
      />,
    );
  }

  const flushImageLoad = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the loaded image centered on the world origin at alpha 0.25', async () => {
    const calls = installRecordingContext();
    renderUnderlay({ underlayEnabled: true });
    await flushImageLoad();

    const draws = calls.filter((c) => c.name === 'drawImage');
    expect(draws.length).toBeGreaterThan(0);
    const last = draws[draws.length - 1];
    expect(last.args.slice(1)).toEqual([-100, -50]);
    expect(last.globalAlpha).toBe(UNDERLAY_ALPHA);
    expect(UNDERLAY_ALPHA).toBe(0.25);
  });

  it('cuts each hidden mask out in the background color', async () => {
    const calls = installRecordingContext();
    renderUnderlay({ underlayEnabled: true, masks: MASKS, masksHidden: true });
    await flushImageLoad();

    for (const m of MASKS) {
      const fills = calls.filter(
        (c) =>
          c.name === 'fillRect' &&
          c.args[0] === m.x &&
          c.args[1] === m.y &&
          c.args[2] === m.w &&
          c.args[3] === m.h,
      );
      expect(fills.length).toBeGreaterThan(0);
      expect(fills[fills.length - 1].fillStyle).toBe('#ffffff');
    }
  });

  it('shows the image through revealed masks (no cutout fill)', async () => {
    const calls = installRecordingContext();
    renderUnderlay({ underlayEnabled: true, masks: MASKS, masksHidden: false });
    await flushImageLoad();

    expect(calls.some((c) => c.name === 'drawImage')).toBe(true);
    const maskFills = calls.filter(
      (c) => c.name === 'fillRect' && MASKS.some((m) => c.args[0] === m.x && c.args[1] === m.y),
    );
    expect(maskFills).toHaveLength(0);
  });

  it('draws nothing from the underlay when disabled', async () => {
    const calls = installRecordingContext();
    renderUnderlay({ underlayEnabled: false, masks: MASKS, masksHidden: true });
    await flushImageLoad();

    expect(calls.some((c) => c.name === 'drawImage')).toBe(false);
    const maskFills = calls.filter(
      (c) => c.name === 'fillRect' && MASKS.some((m) => c.args[0] === m.x && c.args[1] === m.y),
    );
    expect(maskFills).toHaveLength(0);
  });
});

describe('DrawingCanvas pinch rotation', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  function finger(identifier: number, clientX: number, clientY: number): Touch {
    return { identifier, clientX, clientY, touchType: 'direct' } as Touch & { touchType: string };
  }
  // Two fingers 100px apart, centered on the canvas center (200,150), with
  // the line between them at `angleDeg` — a pure twist (no zoom / pan).
  function fingersAt(angleDeg: number): Touch[] {
    const a = deg(angleDeg);
    const dx = 50 * Math.cos(a);
    const dy = 50 * Math.sin(a);
    return [finger(1, 200 - dx, 150 - dy), finger(2, 200 + dx, 150 + dy)];
  }

  let rafQueue: Map<number, FrameRequestCallback>;
  let rafSeq: number;
  beforeEach(() => {
    rafQueue = new Map();
    rafSeq = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.set(++rafSeq, cb);
      return rafSeq;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue.delete(id);
    });
  });
  /** Run queued frames as if `ms` had elapsed (enough to finish any rotation animation). */
  function flushFrames(ms = 1000) {
    const now = performance.now() + ms;
    for (let i = 0; i < 10 && rafQueue.size > 0; i++) {
      const q = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of q) cb(now);
    }
  }

  function renderRotatable(pinchRotateEnabled: boolean, isFlipped = false) {
    const vt = new ViewTransform();
    const view = render(
      <DrawingCanvas
        mode="pen"
        highlightedStrokeIndex={null}
        onHighlightStroke={vi.fn()}
        onStrokeCountChange={vi.fn()}
        strokeManager={new StrokeManager()}
        redrawVersion={0}
        viewResetVersion={0}
        grid={grid}
        guideLines={[]}
        guideVersion={0}
        viewTransform={vt}
        pinchRotateEnabled={pinchRotateEnabled}
        isFlipped={isFlipped}
      />,
    );
    return { vt, canvas: view.container.querySelector('canvas')!, rerender: view.rerender };
  }

  function twist(canvas: HTMLCanvasElement, angles: number[]) {
    fireEvent.touchStart(canvas, { touches: fingersAt(0), changedTouches: fingersAt(0) });
    for (const a of angles) {
      fireEvent.touchMove(canvas, { touches: fingersAt(a), changedTouches: fingersAt(a) });
    }
  }
  function release(canvas: HTMLCanvasElement, angle: number) {
    const [f1, f2] = fingersAt(angle);
    fireEvent.touchEnd(canvas, { touches: [f1], changedTouches: [f2] });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [f1] });
  }

  it('does not rotate while the switch is off', () => {
    const { vt, canvas } = renderRotatable(false);
    twist(canvas, [20, 40, 60]);
    release(canvas, 60);
    flushFrames();
    expect(vt.getRotation()).toBe(0);
  });

  it('ignores twists below the start threshold, then follows the fingers', () => {
    const { vt, canvas } = renderRotatable(true);
    twist(canvas, [5, 8]);
    expect(vt.getRotation()).toBe(0);
    // Same touch session: the twist accumulates, crossing 10° at 12° engages
    // rotation, and later twists turn the view.
    for (const a of [12, 40]) {
      fireEvent.touchMove(canvas, { touches: fingersAt(a), changedTouches: fingersAt(a) });
    }
    expect(vt.getRotation()).toBeCloseTo(deg(28));
    release(canvas, 40);
    flushFrames();
    // 28° is not near a 90° position — no snap.
    expect(vt.getRotation()).toBeCloseTo(deg(28));
  });

  it('snaps to the nearest 90° on release when within 5°', () => {
    const { vt, canvas } = renderRotatable(true);
    twist(canvas, [12, 12 + 87]);
    expect(vt.getRotation()).toBeCloseTo(deg(87));
    release(canvas, 99);
    flushFrames();
    expect(vt.getRotation()).toBeCloseTo(deg(90));
  });

  it('a third finger joining keeps the engaged rotation and the release snap', () => {
    const { vt, canvas } = renderRotatable(true);
    twist(canvas, [12, 12 + 50]);
    expect(vt.getRotation()).toBeCloseTo(deg(50));
    const [f1, f2] = fingersAt(62);
    const f3 = finger(3, 20, 20);
    fireEvent.touchStart(canvas, { touches: [f1, f2, f3], changedTouches: [f3] });
    // Still rotating after the extra finger: twist on to 12+87 → 87°.
    fireEvent.touchMove(canvas, { touches: fingersAt(99), changedTouches: fingersAt(99) });
    expect(vt.getRotation()).toBeCloseTo(deg(87));
    fireEvent.touchEnd(canvas, { touches: fingersAt(99), changedTouches: [f3] });
    release(canvas, 99);
    flushFrames();
    expect(vt.getRotation()).toBeCloseTo(deg(90));
  });

  it('a reset during the snap animation wins over the pending frames', () => {
    const { vt, canvas } = renderRotatable(true);
    twist(canvas, [12, 12 + 87]);
    release(canvas, 99);
    // Animation queued (target 90°); the user resets before it runs.
    act(() => vt.userResetToHome());
    flushFrames();
    expect(vt.getRotation()).toBe(0);
  });

  it('a twist while flipped rotates the canvas the mirrored way', () => {
    const { vt, canvas } = renderRotatable(true, true);
    twist(canvas, [12, 42]);
    expect(vt.getRotation()).toBeCloseTo(deg(-30));
  });

  it('rotation commands step on the 15° grid and reset upright, even with the switch off', () => {
    const { vt, rerender } = renderRotatable(false);
    const props = {
      mode: 'pen' as const,
      highlightedStrokeIndex: null,
      onHighlightStroke: vi.fn(),
      onStrokeCountChange: vi.fn(),
      strokeManager: new StrokeManager(),
      redrawVersion: 0,
      viewResetVersion: 0,
      grid,
      guideLines: [],
      guideVersion: 0,
      viewTransform: vt,
    };
    rerender(<DrawingCanvas {...props} rotationCommand={{ seq: 1, kind: 'step', dir: 1 }} />);
    flushFrames();
    expect(vt.getRotation()).toBeCloseTo(deg(15));
    rerender(<DrawingCanvas {...props} rotationCommand={{ seq: 2, kind: 'step', dir: 1 }} />);
    flushFrames();
    expect(vt.getRotation()).toBeCloseTo(deg(30));
    rerender(<DrawingCanvas {...props} rotationCommand={{ seq: 3, kind: 'reset' }} />);
    flushFrames();
    expect(vt.getRotation()).toBe(0);
    expect(vt.isDirty()).toBe(false);
  });
});
