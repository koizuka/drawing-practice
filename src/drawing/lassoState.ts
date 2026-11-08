import type { Point, Stroke } from './types';
import {
  emptyBoundingBox,
  extendBoundingBox,
  pointInPolygon,
  type BoundingBox,
} from './canvasUtils';

/**
 * In-progress erase-mode lasso (free-form selection). Plain mutable state
 * owned by DrawingCanvas: the pointer handlers drive it, `redrawAll` reads
 * `points` / `selected` / `dashPhase` to render the marching ants and the
 * would-be-deleted highlight.
 *
 * Points are in world coordinates so the selection follows the camera while
 * the user draws.
 */
export class LassoState {
  /** Polygon vertices; null when no lasso is active. */
  points: Point[] | null = null;
  /**
   * Indices of strokes fully enclosed by the current path (live "would be
   * deleted" feedback). Null while there is no closed polygon yet.
   */
  selected: Set<number> | null = null;
  /**
   * Marching-ants phase in screen px, advanced per animation frame (the
   * renderer divides by the view scale to get the world-space dash offset).
   */
  dashPhase = 0;
  /**
   * Running bbox of the polygon, updated incrementally on each append so the
   * per-move enclosure pass can cheaply reject strokes.
   */
  private bbox: BoundingBox | null = null;

  get active(): boolean {
    return this.points !== null;
  }

  /** Begin a new path at `point`. */
  start(point: Point): void {
    this.points = [point];
    const bb = emptyBoundingBox();
    extendBoundingBox(bb, point);
    this.bbox = bb;
    this.selected = null;
    this.dashPhase = 0;
  }

  /** Extend the path (no-op when inactive). */
  append(point: Point): void {
    if (!this.points || !this.bbox) return;
    this.points.push(point);
    extendBoundingBox(this.bbox, point);
  }

  /** Drop the path and its selection. */
  clear(): void {
    this.points = null;
    this.bbox = null;
    this.selected = null;
  }

  advanceDash(): void {
    // ~1px / frame in screen space — visible motion without being distracting.
    this.dashPhase = (this.dashPhase + 0.5) % 1024;
  }

  /**
   * Recompute which strokes are fully enclosed by the path. Strokes for which
   * `isEditable` is false (other layers / frames, hidden or locked layer) are
   * never selected — the lasso only erases what the tap eraser could.
   */
  recomputeSelection(strokes: readonly Stroke[], isEditable: (stroke: Stroke) => boolean): void {
    const polygon = this.points;
    const bb = this.bbox;
    if (!polygon || polygon.length < 3 || !bb) {
      this.selected = null;
      return;
    }
    const selected = new Set<number>();
    for (let i = 0; i < strokes.length; i++) {
      if (!isEditable(strokes[i])) continue;
      const pts = strokes[i].points;
      if (pts.length === 0) continue;
      let allInside = true;
      for (const p of pts) {
        if (
          p.x < bb.minX ||
          p.x > bb.maxX ||
          p.y < bb.minY ||
          p.y > bb.maxY ||
          !pointInPolygon(p, polygon)
        ) {
          allInside = false;
          break;
        }
      }
      if (allInside) selected.add(i);
    }
    this.selected = selected;
  }

  /**
   * End the lasso and return the stroke indices to delete (ascending), or
   * null when nothing is enclosed / the path never closed. Reuses the live
   * selection, so release doesn't redo the geometry pass.
   */
  finish(): number[] | null {
    const polygon = this.points;
    const selected = this.selected;
    this.clear();
    if (!polygon || polygon.length < 3 || !selected || selected.size === 0) return null;
    return Array.from(selected).sort((a, b) => a - b);
  }
}
