import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './ImageViewer';
import { ViewTransform } from '../drawing/ViewTransform';
import type { GridSettings } from '../guides/types';

const grid: GridSettings = { mode: 'none' };

const baseProps = {
  imageUrl: 'https://example.com/test.png',
  viewResetVersion: 0,
  grid,
  guideLines: [] as const,
  guideVersion: 0,
};

function touch(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY } as Touch;
}

const CANVAS_RECT: DOMRect = {
  left: 10,
  top: 20,
  right: 410,
  bottom: 320,
  width: 400,
  height: 300,
  x: 10,
  y: 20,
  toJSON: () => ({}),
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImageViewer pinch gesture', () => {
  it('does not call applyGesture on 2-finger touchStart alone (only on move)', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });

    expect(applyGesture).not.toHaveBeenCalled();
  });

  it('calls applyGesture on 2-finger touchMove', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });

    expect(applyGesture).toHaveBeenCalledTimes(1);
  });

  it('does not call applyGesture on single-finger touchMove', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 150, 150)] });

    expect(applyGesture).not.toHaveBeenCalled();
  });

  it('discards in-progress guide drawing when a 2nd finger touches during guideMode=add', () => {
    const onAddGuideLine = vi.fn();
    const { container } = render(
      <ImageViewer {...baseProps} guideMode="add" onAddGuideLine={onAddGuideLine} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 200, 200)] });
    fireEvent.touchStart(canvas, { changedTouches: [touch(1, 300, 300)] });
    fireEvent.touchEnd(canvas, { changedTouches: [touch(0, 200, 200), touch(1, 300, 300)] });

    expect(onAddGuideLine).not.toHaveBeenCalled();
  });

  it('stops pinching and ignores remaining finger when one lifts', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });
    expect(applyGesture).toHaveBeenCalledTimes(1);

    fireEvent.touchEnd(canvas, { changedTouches: [touch(1, 220, 220)] });
    applyGesture.mockClear();

    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 50, 50)] });
    expect(applyGesture).not.toHaveBeenCalled();
  });

  it('captures canvas rect once at pinch start and reuses it during touchMove', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(CANVAS_RECT);
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    rectSpy.mockClear();

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    const countAfterStart = rectSpy.mock.calls.length;
    expect(countAfterStart).toBeGreaterThanOrEqual(1);

    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 90, 90), touch(1, 210, 210)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 70, 70), touch(1, 230, 230)] });

    expect(rectSpy.mock.calls.length).toBe(countAfterStart);
  });

  it('flips focalX and translateX when isFlipped=true', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(
      <ImageViewer {...baseProps} guideMode="none" isFlipped />,
    );
    const canvas = container.querySelector('canvas')!;

    // pinch starts with midpoint (100, 100); rect.left=10 rect.top=20 rect.width=400
    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 50, 50), touch(1, 150, 150)] });
    // expand — midpoint unchanged (still 100, 100), translate should be 0
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 30, 30), touch(1, 170, 170)] });

    expect(applyGesture).toHaveBeenCalledTimes(1);
    const [focalX, focalY, scaleDelta, translateX, translateY] = applyGesture.mock.calls[0];
    // raw focalX = 100 - 10 = 90 → flipped = 400 - 90 = 310
    expect(focalX).toBeCloseTo(310);
    expect(focalY).toBeCloseTo(80);
    expect(scaleDelta).toBeGreaterThan(1);
    expect(translateX).toBe(-0);
    expect(translateY).toBe(0);
  });

  it('passes non-flipped focalX when isFlipped=false', () => {
    const applyGesture = vi.spyOn(ViewTransform.prototype, 'applyGesture');
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 50, 50), touch(1, 150, 150)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 30, 30), touch(1, 170, 170)] });

    const [focalX, focalY] = applyGesture.mock.calls[0];
    expect(focalX).toBeCloseTo(90);
    expect(focalY).toBeCloseTo(80);
  });

  it('applies scaleX(-1) inline transform on the container when isFlipped is true', () => {
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" isFlipped />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.transform).toBe('scaleX(-1)');
  });

  it('does not apply a transform when isFlipped is false', () => {
    const { container } = render(<ImageViewer {...baseProps} guideMode="none" />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.transform).toBe('');
  });
});
