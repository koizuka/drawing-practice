import type { Point } from '../drawing/types';

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Total polyline length (open). */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Resample a polyline into N+1 equally arc-length-spaced points, including
 * both endpoints. Handles degenerate cases by repeating the single available
 * point. Input must have at least 1 point.
 */
export function resampleByArcLength(points: readonly Point[], n: number): Point[] {
  if (n < 1) throw new Error('resampleByArcLength: n must be >= 1');
  if (points.length === 0) throw new Error('resampleByArcLength: empty input');
  if (points.length === 1) {
    const p = points[0];
    return Array.from({ length: n + 1 }, () => ({ x: p.x, y: p.y }));
  }

  const total = polylineLength(points);
  if (total === 0) {
    const p = points[0];
    return Array.from({ length: n + 1 }, () => ({ x: p.x, y: p.y }));
  }

  const step = total / n;
  const result: Point[] = [{ x: points[0].x, y: points[0].y }];
  let segIdx = 0;
  let segStart = points[0];
  let segEnd = points[1];
  let segLen = dist(segStart, segEnd);
  let consumed = 0; // distance consumed from segStart along current segment

  for (let i = 1; i < n; i++) {
    let remaining = step;
    while (remaining > segLen - consumed) {
      remaining -= segLen - consumed;
      segIdx++;
      if (segIdx >= points.length - 1) {
        // Hit the end (floating-point drift); clamp to last point.
        result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
        // Fill the rest with the last point.
        while (result.length < n + 1) {
          result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
        }
        return result;
      }
      segStart = points[segIdx];
      segEnd = points[segIdx + 1];
      segLen = dist(segStart, segEnd);
      consumed = 0;
    }
    consumed += remaining;
    const t = segLen === 0 ? 0 : consumed / segLen;
    result.push({
      x: segStart.x + (segEnd.x - segStart.x) * t,
      y: segStart.y + (segEnd.y - segStart.y) * t,
    });
  }
  result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return result;
}

/** Reverse a polyline in place (returns a new array). */
export function reversePolyline(points: readonly Point[]): Point[] {
  return points.slice().reverse();
}
