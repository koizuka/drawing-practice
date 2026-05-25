import type { Point } from '../drawing/types';
import { polylineLength } from '../trace/resample';
import type { TraceStroke } from '../trace/types';

/**
 * Default segments-per-curve for the bundled templates. Picked so the
 * sampled polyline closely tracks smooth curves at typical viewBox sizes
 * (~1000px) without producing oversized arrays.
 */
const DEFAULT_SEGMENTS = 96;

export function circle(cx: number, cy: number, r: number, segments = DEFAULT_SEGMENTS): TraceStroke {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  pts.push({ x: pts[0].x, y: pts[0].y });
  return { points: pts, length: polylineLength(pts), closed: true };
}

export function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  segments = DEFAULT_SEGMENTS,
): TraceStroke {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    const lx = rx * Math.cos(a);
    const ly = ry * Math.sin(a);
    pts.push({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    });
  }
  pts.push({ x: pts[0].x, y: pts[0].y });
  return { points: pts, length: polylineLength(pts), closed: true };
}

export function cubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  segments = DEFAULT_SEGMENTS,
): TraceStroke {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const omt = 1 - t;
    const x = omt * omt * omt * p0.x + 3 * omt * omt * t * p1.x + 3 * omt * t * t * p2.x + t * t * t * p3.x;
    const y = omt * omt * omt * p0.y + 3 * omt * omt * t * p1.y + 3 * omt * t * t * p2.y + t * t * t * p3.y;
    pts.push({ x, y });
  }
  return { points: pts, length: polylineLength(pts), closed: false };
}

/**
 * Build a polyline stroke. `closed=true` appends the first point as the last
 * (which scoring treats as a circular ring).
 */
export function polyline(points: readonly Point[], closed = false): TraceStroke {
  const pts = points.map(p => ({ ...p }));
  if (closed && pts.length > 0) pts.push({ x: pts[0].x, y: pts[0].y });
  return { points: pts, length: polylineLength(pts), closed };
}

/**
 * Build a smooth open curve sampled from a series of cubic bezier segments
 * that join at the given anchor points. Used for S-curves and hair lines
 * where natural curvature matters more than precise tangent control.
 */
export function smoothCurve(controlGroups: { p0: Point; p1: Point; p2: Point; p3: Point }[], segPerCurve = 24): TraceStroke {
  const pts: Point[] = [];
  controlGroups.forEach((g, idx) => {
    for (let i = 0; i <= segPerCurve; i++) {
      if (i === 0 && idx > 0) continue; // dedup join
      const t = i / segPerCurve;
      const omt = 1 - t;
      const x = omt * omt * omt * g.p0.x + 3 * omt * omt * t * g.p1.x + 3 * omt * t * t * g.p2.x + t * t * t * g.p3.x;
      const y = omt * omt * omt * g.p0.y + 3 * omt * omt * t * g.p1.y + 3 * omt * t * t * g.p2.y + t * t * t * g.p3.y;
      pts.push({ x, y });
    }
  });
  return { points: pts, length: polylineLength(pts), closed: false };
}
