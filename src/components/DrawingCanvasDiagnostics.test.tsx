import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingCanvas } from './DrawingCanvas';
import { StrokeManager } from '../drawing/StrokeManager';
import { diag, resetDiag, clearLog, getLog } from '../drawing/touchDiagnostics';
import type { GridSettings } from '../guides/types';

// Force the diagnostics gate on while keeping the real `diag` singleton so the
// counters DrawingCanvas mutates are the same object we assert against. This
// avoids vi.resetModules() (which would duplicate React and break hooks).
vi.mock('../drawing/touchDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../drawing/touchDiagnostics')>();
  return { ...actual, DIAG_ENABLED: true };
});

const grid: GridSettings = { mode: 'none' };

const CANVAS_RECT: DOMRect = {
  left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}),
};

let originalResizeObserver: typeof globalThis.ResizeObserver;

function stylus(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY, touchType: 'stylus' } as Touch & { touchType: string };
}

function direct(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY, touchType: 'direct' } as Touch & { touchType: string };
}

function renderCanvas(strokeManager = new StrokeManager()) {
  const view = render(
    <DrawingCanvas
      mode="pen"
      highlightedStrokeIndex={null}
      onHighlightStroke={vi.fn()}
      onStrokeCountChange={vi.fn()}
      strokeManager={strokeManager}
      redrawVersion={0}
      viewResetVersion={0}
      grid={grid}
      guideLines={[]}
      guideVersion={0}
    />,
  );
  return { ...view, canvas: view.container.querySelector('canvas')!, strokeManager };
}

beforeEach(() => {
  resetDiag();
  clearLog();
  originalResizeObserver = globalThis.ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);
  globalThis.ResizeObserver = class ResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) { this.cb([{ target, contentRect: CANVAS_RECT } as ResizeObserverEntry], this); }
    unobserve() {}
    disconnect() {}
  } as typeof globalThis.ResizeObserver;
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

describe('DrawingCanvas diagnostics counters', () => {
  it('counts a normal stylus stroke as appended + committed and redrawn', () => {
    const { canvas } = renderCanvas();

    fireEvent.touchStart(canvas, { touches: [stylus(1, 20, 20)], changedTouches: [stylus(1, 20, 20)] });
    fireEvent.touchMove(canvas, { touches: [stylus(1, 50, 60)], changedTouches: [stylus(1, 50, 60)] });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [stylus(1, 50, 60)] });

    expect(diag.touchstart).toBe(1);
    expect(diag.startStroke).toBe(1);
    expect(diag.touchTypeStylus).toBe(1);
    expect(diag.appendOk).toBeGreaterThanOrEqual(1);
    expect(diag.endCommit).toBe(1);
    expect(diag.redrawAll).toBeGreaterThan(0);
  });

  it('records the Hypothesis-A drop: after a stylus touch, a non-stylus move is rejected by the stylus filter', () => {
    const { canvas, strokeManager } = renderCanvas();

    // First a stylus contact sets hasStylusRef = true.
    fireEvent.touchStart(canvas, { touches: [stylus(1, 20, 20)], changedTouches: [stylus(1, 20, 20)] });
    fireEvent.touchEnd(canvas, { touches: [], changedTouches: [stylus(1, 20, 20)] });

    // A subsequent stroke arriving as touchType 'direct' (the suspected iPadOS
    // Pencil misclassification) must be dropped by the stylus filter, and the
    // diagnostic must capture it with the offending touchType.
    fireEvent.touchStart(canvas, { touches: [direct(2, 80, 80)], changedTouches: [direct(2, 80, 80)] });
    fireEvent.touchMove(canvas, { touches: [direct(2, 110, 120)], changedTouches: [direct(2, 110, 120)] });

    expect(diag.rejStylusFilterStart).toBeGreaterThanOrEqual(1);
    // The move never appended a point.
    expect(strokeManager.getCurrentStroke()).toBeNull();
    // A rejection event with the offending touchType was logged.
    const rejected = getLog().filter(e => e.type === 'rej' && e.detail?.reason === 'stylusFilterStart');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(rejected[0].detail?.touchType).toBe('direct');
  });

  it('counts resets with their trigger on window blur', () => {
    const { canvas } = renderCanvas();
    fireEvent.touchStart(canvas, { touches: [stylus(1, 20, 20)], changedTouches: [stylus(1, 20, 20)] });

    window.dispatchEvent(new Event('blur'));

    expect(diag.resetCount).toBeGreaterThanOrEqual(1);
    expect(diag.lastResetTrigger).toBe('blur');
  });
});
