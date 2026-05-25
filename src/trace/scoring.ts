import type { Point, Stroke } from '../drawing/types';
import { dist, polylineLength, resampleByArcLength, reversePolyline } from './resample';
import { closestPointOnPolyline, rotateClosedPolyline } from './polylineGeom';
import type { TraceFeedback, TraceMatch, TraceStroke } from './types';

/**
 * Number of equal-arc-length samples used per stroke for comparison.
 * `resampleByArcLength(points, SCORING_N)` returns `SCORING_N + 1` points
 * (both endpoints included), and `buildFeedback` emits one deviation
 * segment per sample — so increasing this raises both per-attempt CPU cost
 * and the number of red feedback bands drawn on the canvas.
 */
export const SCORING_N = 64;

/** Endpoint match tolerance for open templates (world px). */
export function endpointTolerance(templateLength: number): number {
  return Math.max(templateLength * 0.05, 12);
}

/** Closure tolerance for closed templates (world px). */
export function closureTolerance(templateLength: number): number {
  return Math.max(templateLength * 0.05, 16);
}

/**
 * Acceptable ratio range of user stroke length to template length. A spiral
 * or scribble whose endpoints happen to land near the template endpoints
 * could otherwise pass endpointTolerance and be "scored" with a meaningless
 * percentage. Strict enough to reject obvious wrong-shape attempts but
 * loose enough to accept hand-shake on slow careful traces.
 */
const LENGTH_RATIO_MIN = 0.5;
const LENGTH_RATIO_MAX = 3.0;

function lengthRatioOk(userLength: number, templateLength: number): boolean {
  if (templateLength === 0) return false;
  const ratio = userLength / templateLength;
  return ratio >= LENGTH_RATIO_MIN && ratio <= LENGTH_RATIO_MAX;
}

function meanDistance(a: readonly Point[], b: readonly Point[]): number {
  if (a.length !== b.length) throw new Error('meanDistance: length mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += dist(a[i], b[i]);
  return sum / a.length;
}

/**
 * Try to match a user stroke against a single open template stroke.
 * Returns the best (forward/reverse) match, or null if endpoints are too far.
 */
function matchOpen(
  user: Stroke,
  template: TraceStroke,
  templateStrokeIdx: number,
): TraceMatch | null {
  if (user.points.length < 2 || template.points.length < 2) return null;
  if (!lengthRatioOk(polylineLength(user.points), template.length)) return null;
  const userStart = user.points[0];
  const userEnd = user.points[user.points.length - 1];
  const tStart = template.points[0];
  const tEnd = template.points[template.points.length - 1];
  const tol = endpointTolerance(template.length);

  const userSamples = resampleByArcLength(user.points, SCORING_N);
  let best: TraceMatch | null = null;

  // Forward
  const dForwardStart = dist(userStart, tStart);
  const dForwardEnd = dist(userEnd, tEnd);
  if (Math.max(dForwardStart, dForwardEnd) <= tol) {
    const tplSamples = resampleByArcLength(template.points, SCORING_N);
    const mean = meanDistance(userSamples, tplSamples);
    best = {
      templateStrokeIdx,
      meanError: mean,
      errorPct: (mean / template.length) * 100,
      userSamples,
      templateSamples: tplSamples,
    };
  }

  // Reverse
  const dReverseStart = dist(userStart, tEnd);
  const dReverseEnd = dist(userEnd, tStart);
  if (Math.max(dReverseStart, dReverseEnd) <= tol) {
    const reversed = reversePolyline(template.points);
    const tplSamples = resampleByArcLength(reversed, SCORING_N);
    const mean = meanDistance(userSamples, tplSamples);
    if (!best || mean < best.meanError) {
      best = {
        templateStrokeIdx,
        meanError: mean,
        errorPct: (mean / template.length) * 100,
        userSamples,
        templateSamples: tplSamples,
      };
    }
  }

  return best;
}

/**
 * Try to match a user stroke against a single closed template stroke.
 * Returns the best match over (start position × direction), or null if not
 * sufficiently closed or the start point is far from the template.
 */
function matchClosed(
  user: Stroke,
  template: TraceStroke,
  templateStrokeIdx: number,
): TraceMatch | null {
  if (user.points.length < 2) return null;
  if (!lengthRatioOk(polylineLength(user.points), template.length)) return null;
  const userStart = user.points[0];
  const userEnd = user.points[user.points.length - 1];

  // Must be approximately closed.
  if (dist(userStart, userEnd) > closureTolerance(template.length)) return null;

  // Start must lie near the template ring.
  const proj = closestPointOnPolyline(userStart, template.points);
  if (proj.perpDist > endpointTolerance(template.length)) return null;

  const userSamples = resampleByArcLength(user.points, SCORING_N);
  let best: TraceMatch | null = null;

  for (const reverse of [false, true]) {
    const tplSamples = rotateClosedPolyline(template, proj.arcLen, reverse, SCORING_N);
    const mean = meanDistance(userSamples, tplSamples);
    if (!best || mean < best.meanError) {
      best = {
        templateStrokeIdx,
        meanError: mean,
        errorPct: (mean / template.length) * 100,
        userSamples,
        templateSamples: tplSamples,
      };
    }
  }

  return best;
}

/**
 * Score a user attempt against all template strokes. Returns the best match
 * across all candidates, or null when nothing qualified (user should be
 * shown no feedback and the stroke should be discarded).
 */
export function scoreAttempt(
  user: Stroke,
  templates: readonly TraceStroke[],
): TraceMatch | null {
  if (user.points.length < 2) return null;
  // Defensively reject zero-length strokes.
  if (polylineLength(user.points) === 0) return null;

  let best: TraceMatch | null = null;
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const m = t.closed ? matchClosed(user, t, i) : matchOpen(user, t, i);
    if (!m) continue;
    if (!best || m.meanError < best.meanError) best = m;
  }
  return best;
}

/** Build a TraceFeedback object from a successful match. */
export function buildFeedback(match: TraceMatch): TraceFeedback {
  const segments = match.userSamples.map((u, i) => {
    const t = match.templateSamples[i];
    return {
      from: u,
      to: t,
      magnitude: dist(u, t),
    };
  });
  return {
    templateStrokeIdx: match.templateStrokeIdx,
    segments,
    errorPct: match.errorPct,
  };
}
