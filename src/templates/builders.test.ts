import { describe, it, expect } from 'vitest';
import { circle, ellipse, cubicBezier, polyline } from './builders';

describe('builders', () => {
  it('circle is closed and has length ≈ 2πr', () => {
    const c = circle(0, 0, 100, 256);
    expect(c.closed).toBe(true);
    expect(c.length).toBeCloseTo(2 * Math.PI * 100, 0);
    // First and last points are coincident
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    expect(first.x).toBeCloseTo(last.x);
    expect(first.y).toBeCloseTo(last.y);
  });

  it('ellipse with equal radii ≈ circle', () => {
    const e = ellipse(0, 0, 100, 100, 0, 256);
    expect(e.length).toBeCloseTo(2 * Math.PI * 100, 0);
    expect(e.closed).toBe(true);
  });

  it('cubicBezier is an open polyline', () => {
    const b = cubicBezier(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      32,
    );
    expect(b.closed).toBe(false);
    expect(b.length).toBeGreaterThan(0);
    expect(b.points[0]).toEqual({ x: 0, y: 0 });
    expect(b.points[b.points.length - 1]).toEqual({ x: 0, y: 100 });
  });

  it('polyline with closed=true appends the first point as last', () => {
    const tri = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], true);
    expect(tri.closed).toBe(true);
    expect(tri.points).toHaveLength(4);
    expect(tri.points[3]).toEqual({ x: 0, y: 0 });
  });
});
