import { polyline, smoothCurve, circle } from './builders';
import type { TraceTemplate } from './types';
import type { Point } from '../drawing/types';

const VIEW = 1000;

/** Sample a closed shape as a Catmull-Rom-smoothed loop through control radii. */
function blobShape(cx: number, cy: number, radii: number[], segPer: number): Point[] {
  const n = radii.length;
  const ctrlPts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = radii[i];
    ctrlPts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrlPts[(i - 1 + n) % n];
    const p1 = ctrlPts[i];
    const p2 = ctrlPts[(i + 1) % n];
    const p3 = ctrlPts[(i + 2) % n];
    for (let s = 0; s <= segPer; s++) {
      const t = s / segPer;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom basis (tension 0.5).
      const x = 0.5 * ((2 * p1.x)
        + (-p0.x + p2.x) * t
        + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
        + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y)
        + (-p0.y + p2.y) * t
        + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
        + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Organic closed-shape outlines (avocado-like, leaf, drop) — exercises closed
 * stroke tracing where start/end direction is free.
 */
export const blobTemplate: TraceTemplate = {
  id: 'bundle:blobs',
  titleKey: 'tmplBlobs',
  viewBox: { w: VIEW, h: VIEW },
  strokes: [
    // Egg / avocado-ish
    polyline(blobShape(-250, -200, [200, 220, 240, 220, 200, 180, 170, 180], 12), true),
    // Leaf / mandorla
    polyline(blobShape(200, -200, [80, 220, 80, 220], 18), true),
    // Teardrop
    polyline(blobShape(-200, 200, [200, 180, 130, 90, 60, 90, 130, 180], 12), true),
    // Wavy organic shape
    polyline(blobShape(220, 220, [180, 140, 170, 120, 180, 140, 170, 130], 12), true),
    // Plain reference circle for comparison
    circle(0, 0, 40),
    // Long curved spine for free-form practice
    smoothCurve([
      { p0: { x: -420, y: 420 }, p1: { x: -100, y: 380 }, p2: { x: 100, y: 460 }, p3: { x: 420, y: 380 } },
    ]),
  ],
};
