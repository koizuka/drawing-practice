import { describe, it, expect } from 'vitest';
import { pointInPolygon } from './canvasUtils';
import type { Point } from './types';

describe('pointInPolygon', () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('returns true for a point clearly inside a convex polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon({ x: 20, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 20 }, square)).toBe(false);
  });

  it('returns false for a degenerate polygon (fewer than 3 points)', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('handles concave (non-convex) polygons correctly', () => {
    // C shape opening to the right.
    const cShape: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 7 },
      { x: 10, y: 7 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    // Inside the left bar of the C.
    expect(pointInPolygon({ x: 1, y: 5 }, cShape)).toBe(true);
    // Inside the top bar.
    expect(pointInPolygon({ x: 5, y: 1 }, cShape)).toBe(true);
    // In the C's notch (outside the polygon).
    expect(pointInPolygon({ x: 7, y: 5 }, cShape)).toBe(false);
  });

  it('treats the polygon as implicitly closed (no need to repeat first point)', () => {
    const explicitlyClosed = [...square, { x: 0, y: 0 }];
    expect(pointInPolygon({ x: 5, y: 5 }, explicitlyClosed)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('handles a triangle', () => {
    const triangle: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 1 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 11 }, triangle)).toBe(false);
    // Outside, to the right of the right edge.
    expect(pointInPolygon({ x: 9, y: 9 }, triangle)).toBe(false);
  });
});
