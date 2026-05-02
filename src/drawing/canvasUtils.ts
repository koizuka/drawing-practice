import type { Point } from './types'
import type { ContainerSize } from './ViewTransform'

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
  if (!content || container.width <= 0 || container.height <= 0) return 1
  if (content.width <= 0 || content.height <= 0) return 1
  return Math.min(container.width / content.width, container.height / content.height)
}

/** Stroke center for content (image center if present, world origin otherwise). */
export function computeContentCenter(content?: { width: number; height: number }): Point {
  return content ? { x: content.width / 2, y: content.height / 2 } : { x: 0, y: 0 }
}

/** Draw a polyline stroke path in the current ctx transform. No-op for <2 points. */
export function drawOverlayStrokePath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
}
