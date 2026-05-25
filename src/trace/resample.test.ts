import { describe, it, expect } from 'vitest';
import { dist, polylineLength, resampleByArcLength, reversePolyline } from './resample';

describe('resample', () => {
  it('polylineLength returns 0 for a single point', () => {
    expect(polylineLength([{ x: 0, y: 0 }])).toBe(0);
  });

  it('polylineLength sums segment lengths', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(polylineLength(pts)).toBe(7);
  });

  it('resampleByArcLength preserves endpoints on a straight line', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const out = resampleByArcLength(pts, 4);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[4]).toEqual({ x: 10, y: 0 });
    // Equispaced
    expect(out[1].x).toBeCloseTo(2.5);
    expect(out[2].x).toBeCloseTo(5);
    expect(out[3].x).toBeCloseTo(7.5);
  });

  it('resampleByArcLength handles an L-shape', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    const out = resampleByArcLength(pts, 7);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[7]).toEqual({ x: 3, y: 4 });
    // Equal spacing of 1.0 each
    expect(dist(out[0], out[1])).toBeCloseTo(1, 5);
    expect(dist(out[3], out[4])).toBeCloseTo(1, 5);
  });

  it('resampleByArcLength handles a circular path approximately equidistant', () => {
    const n = 64;
    const r = 100;
    const raw: { x: number; y: number }[] = [];
    for (let i = 0; i <= 360; i++) {
      const a = (i / 360) * 2 * Math.PI;
      raw.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    const out = resampleByArcLength(raw, n);
    expect(out).toHaveLength(n + 1);
    // All sampled radii should be ~r
    for (const p of out) {
      expect(Math.sqrt(p.x * p.x + p.y * p.y)).toBeCloseTo(r, 0);
    }
  });

  it('reversePolyline reverses order without mutating input', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    const r = reversePolyline(pts);
    expect(r[0]).toEqual({ x: 2, y: 2 });
    expect(r[2]).toEqual({ x: 0, y: 0 });
    expect(pts[0]).toEqual({ x: 0, y: 0 });
  });
});
