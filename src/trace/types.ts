import type { Point } from '../drawing/types';

/**
 * One stroke of a trace template (target line the user attempts to trace over).
 * Coordinates are in world space (viewBox centered on grid origin).
 * For `closed: true` strokes, points[0] and points[last] are coincident
 * (builders close the ring explicitly); scoring treats them as circular.
 */
export interface TraceStroke {
  points: Point[];
  /** Total arc length of the polyline. Used to normalize error percentages. */
  length: number;
  /** Closed shapes (circle, ellipse, blob) — start/end are not anchored. */
  closed: boolean;
}

/**
 * Result of evaluating one user attempt against the template strokes.
 * `null` when no candidate template stroke matched (attempt is discarded).
 */
export interface TraceMatch {
  templateStrokeIdx: number;
  meanError: number;
  errorPct: number;
  /** N=64 sampled user points used for the match (re-used for feedback). */
  userSamples: Point[];
  /** N=64 sampled, aligned-and-direction-resolved template points. */
  templateSamples: Point[];
}

/**
 * Per-stroke deviation visualization. One feedback per scored attempt; cleared
 * on the next stroke start.
 */
export interface TraceFeedback {
  templateStrokeIdx: number;
  /** N segments connecting user sample to template sample. */
  segments: { from: Point; to: Point; magnitude: number }[];
  errorPct: number;
}

export interface TemplateScore {
  templateStrokeIdx: number;
  bestErrorPct: number;
  attempts: number;
}
