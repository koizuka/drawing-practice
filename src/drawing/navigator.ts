/**
 * Pure geometry for the drawing-panel navigator (overview map + "which way
 * is up" marker). The navigator is drawn in SCREEN orientation: it shows the
 * world as it currently appears (rotated, and mirrored while flipped), so the
 * viewport is always an upright rectangle in its middle and "content to the
 * left in the map" means "content off the left edge of the screen".
 */
import type { Point } from './types';
import type { ContainerSize, ProjectionMatrix } from './ViewTransform';

/** World → on-screen point (CSS px in the drawing container), including the CSS flip. */
export function makeWorldToScreen(
  m: ProjectionMatrix,
  containerWidth: number,
  flipped: boolean,
): (p: Point) => Point {
  return (p) => {
    const x = m.a * p.x + m.c * p.y + m.e;
    const y = m.b * p.x + m.d * p.y + m.f;
    return { x: flipped ? containerWidth - x : x, y };
  };
}

/**
 * Map scale (navigator px per screen px) that fits the viewport and every
 * content point inside a disc of `radius` centered on the screen center.
 * Distances from the screen center don't change when the view turns about
 * that center, so the map holds its size while rotating instead of
 * breathing like an axis-aligned fit would.
 */
export function navigatorScale(
  container: ContainerSize,
  screenPoints: readonly Point[],
  radius: number,
): number {
  const cx = container.width / 2;
  const cy = container.height / 2;
  let r = Math.hypot(cx, cy);
  for (const p of screenPoints) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > r) r = d;
  }
  return r > 0 ? radius / r : 1;
}

/**
 * On-screen direction of world "up" as an angle from screen-up, clockwise
 * positive (radians). 0 ⇔ the paper is upright.
 */
export function worldUpScreenAngle(m: ProjectionMatrix, flipped: boolean): number {
  // World up (0, -1) through the linear part: (-c, -d).
  const vx = flipped ? m.c : -m.c;
  const vy = -m.d;
  return Math.atan2(vx, -vy);
}
