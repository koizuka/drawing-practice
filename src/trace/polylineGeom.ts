import type { Point } from '../drawing/types';
import { dist, resampleByArcLength } from './resample';
import type { TraceStroke } from './types';

export interface ClosestPointResult {
  arcLen: number;
  perpDist: number;
  point: Point;
}

/**
 * Closest point on an (open or closed-as-input) polyline to a query point.
 * For each segment we project p onto the segment and keep the smallest
 * perpendicular distance. arcLen is the distance from points[0] to the foot.
 */
export function closestPointOnPolyline(p: Point, points: readonly Point[]): ClosestPointResult {
  if (points.length === 0) throw new Error('closestPointOnPolyline: empty polyline');
  if (points.length === 1) {
    return { arcLen: 0, perpDist: dist(p, points[0]), point: { ...points[0] } };
  }

  let best: ClosestPointResult = { arcLen: 0, perpDist: Infinity, point: { ...points[0] } };
  let runLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    let t = 0;
    if (segLen2 > 0) {
      t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const foot: Point = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(p, foot);
    if (d < best.perpDist) {
      const segLen = Math.sqrt(segLen2);
      best = { arcLen: runLen + segLen * t, perpDist: d, point: foot };
    }
    runLen += Math.sqrt(segLen2);
  }
  return best;
}

/**
 * Resample a CLOSED polyline starting at arc length `startArcLen` for one
 * full revolution, returning N+1 points. If `reverse` is true, traverses in
 * the opposite direction. The closed polyline is treated as a ring (the
 * caller's points[0] == points[last] is OK; the ring length is taken from
 * the input length sans the trailing duplicate).
 */
export function rotateClosedPolyline(
  stroke: TraceStroke,
  startArcLen: number,
  reverse: boolean,
  n: number,
): Point[] {
  if (!stroke.closed) throw new Error('rotateClosedPolyline: stroke is not closed');
  const pts = stroke.points;
  if (pts.length < 2) throw new Error('rotateClosedPolyline: need at least 2 points');

  // Build cumulative arc-length table for the ring (ignoring the trailing
  // duplicate vertex if present, to avoid a zero-length segment that messes
  // up parameterization).
  const ring: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === pts.length - 1 && pts[i].x === pts[0].x && pts[i].y === pts[0].y) break;
    ring.push(pts[i]);
  }
  const m = ring.length;
  if (m < 2) throw new Error('rotateClosedPolyline: degenerate ring');

  const segLens: number[] = new Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % m];
    const l = dist(a, b);
    segLens[i] = l;
    total += l;
  }
  if (total === 0) {
    return Array.from({ length: n + 1 }, () => ({ ...ring[0] }));
  }

  // Normalize startArcLen into [0, total)
  let s = startArcLen % total;
  if (s < 0) s += total;

  // Walk the ring in the given direction, building an open polyline of length
  // `total` starting at s. Then feed it through resampleByArcLength.
  const walk: Point[] = [];
  // Find segment containing s.
  let acc = 0;
  let startSeg = 0;
  let startT = 0;
  for (let i = 0; i < m; i++) {
    if (acc + segLens[i] >= s || i === m - 1) {
      startSeg = i;
      startT = segLens[i] === 0 ? 0 : (s - acc) / segLens[i];
      break;
    }
    acc += segLens[i];
  }

  if (!reverse) {
    // First point: interpolated start
    const a = ring[startSeg];
    const b = ring[(startSeg + 1) % m];
    walk.push({ x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT });
    // Remaining of current segment
    walk.push({ x: b.x, y: b.y });
    for (let k = 1; k < m; k++) {
      const idx = (startSeg + 1 + k) % m;
      walk.push({ x: ring[idx].x, y: ring[idx].y });
    }
    // Closing point: back to start
    walk.push({ x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT });
  }
  else {
    // Reverse traversal: start at same projected point, go backward.
    const a = ring[startSeg];
    const b = ring[(startSeg + 1) % m];
    walk.push({ x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT });
    walk.push({ x: a.x, y: a.y });
    for (let k = 1; k < m; k++) {
      const idx = (startSeg - k + m * m) % m;
      walk.push({ x: ring[idx].x, y: ring[idx].y });
    }
    walk.push({ x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT });
  }

  return resampleByArcLength(walk, n);
}
