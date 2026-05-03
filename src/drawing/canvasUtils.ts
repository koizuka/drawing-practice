import type { Point } from './types';
import type { ContainerSize } from './ViewTransform';

/**
 * Fit-to-container scale: the largest scale that lets `content` fit inside
 * `container` while preserving aspect ratio. Returns 1 when there's no
 * content or the container hasn't been laid out yet (degenerate sizes), so
 * callers can treat the absence of a fit target as "no scaling".
 */
export function computeBaseScale(
  container: ContainerSize,
  content: { width: number; height: number } | null | undefined,
): number {
  if (!content || container.width <= 0 || container.height <= 0) return 1;
  if (content.width <= 0 || content.height <= 0) return 1;
  return Math.min(container.width / content.width, container.height / content.height);
}

/**
 * The grid-center anchor in world coordinates. Always (0, 0): every reference
 * (image, YouTube logical canvas, etc.) is rendered with its center at the
 * world origin, so the grid center never moves when the reference changes.
 * Strokes drawn at world coord (50, 30) stay 50 right / 30 down of the grid
 * center across reference loads — only the rendering scale shifts.
 */
export const GRID_CENTER: Point = { x: 0, y: 0 };

/** Draw a polyline stroke path in the current ctx transform. No-op for <2 points. */
export function drawOverlayStrokePath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Empty bbox seed; expand against points using `extendBoundingBox`. */
export function emptyBoundingBox(): BoundingBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBoundingBox(bb: BoundingBox, p: Point): void {
  if (p.x < bb.minX) bb.minX = p.x;
  if (p.y < bb.minY) bb.minY = p.y;
  if (p.x > bb.maxX) bb.maxX = p.x;
  if (p.y > bb.maxY) bb.maxY = p.y;
}

/**
 * Ray-casting point-in-polygon test. The polygon is treated as implicitly
 * closed (the segment from polygon[n-1] to polygon[0] is included), so callers
 * do not need to repeat the first point at the end. Returns false when the
 * polygon has fewer than 3 vertices (no enclosed area).
 *
 * Edge behavior is unspecified by design — points lying exactly on an edge may
 * be reported either way depending on floating-point tie-breaking. For the
 * lasso-delete use case this is acceptable since stroke points are sampled
 * pixel positions, not arbitrarily-aligned coordinates.
 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersects = ((yi > p.y) !== (yj > p.y))
      && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
