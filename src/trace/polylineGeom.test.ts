import { describe, it, expect } from 'vitest';
import { closestPointOnPolyline, rotateClosedPolyline } from './polylineGeom';
import { polylineLength, dist } from './resample';
import type { TraceStroke } from './types';

function makeRing(r: number, n: number): TraceStroke {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  pts.push({ x: pts[0].x, y: pts[0].y }); // close
  return { points: pts, length: polylineLength(pts), closed: true };
}

describe('closestPointOnPolyline', () => {
  it('returns the perp-foot on a horizontal segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const r = closestPointOnPolyline({ x: 5, y: 3 }, pts);
    expect(r.point.x).toBeCloseTo(5);
    expect(r.point.y).toBeCloseTo(0);
    expect(r.perpDist).toBeCloseTo(3);
    expect(r.arcLen).toBeCloseTo(5);
  });

  it('clamps to the nearest endpoint when projection is outside', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const r = closestPointOnPolyline({ x: -5, y: 0 }, pts);
    expect(r.point.x).toBeCloseTo(0);
    expect(r.arcLen).toBeCloseTo(0);
  });

  it('finds the closest of multiple segments', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const r = closestPointOnPolyline({ x: 11, y: 5 }, pts);
    expect(r.point.x).toBeCloseTo(10);
    expect(r.point.y).toBeCloseTo(5);
    expect(r.arcLen).toBeCloseTo(15);
  });
});

describe('rotateClosedPolyline', () => {
  it('starts at the projected arc length and returns N+1 points', () => {
    const ring = makeRing(100, 64);
    const out = rotateClosedPolyline(ring, 0, false, 32);
    expect(out).toHaveLength(33);
    // First point ≈ (100, 0) (angle 0)
    expect(out[0].x).toBeCloseTo(100, 0);
    expect(out[0].y).toBeCloseTo(0, 0);
    // Final point closes back to start
    expect(dist(out[0], out[out.length - 1])).toBeLessThan(0.5);
  });

  it('produces equally distributed points around a circle (forward)', () => {
    const ring = makeRing(100, 128);
    const out = rotateClosedPolyline(ring, 0, false, 32);
    // All samples should be ~radius 100
    for (const p of out) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y);
      expect(r).toBeCloseTo(100, 0);
    }
  });

  it('reverse direction starts at the same point but traverses opposite way', () => {
    const ring = makeRing(100, 128);
    const total = ring.length;
    const startArc = total * 0.25; // 90 degrees CCW from (100,0) ≈ (0, 100)
    const fwd = rotateClosedPolyline(ring, startArc, false, 32);
    const rev = rotateClosedPolyline(ring, startArc, true, 32);
    expect(dist(fwd[0], rev[0])).toBeLessThan(0.5);
    // After 1 step, forward and reverse should diverge
    expect(dist(fwd[1], rev[1])).toBeGreaterThan(5);
  });
});
