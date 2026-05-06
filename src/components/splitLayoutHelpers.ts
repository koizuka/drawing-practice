import type { ReferenceSource, ReferenceMode } from '../types';

export type FitLeader = 'reference' | 'drawing';

/**
 * Which panel owns the fit-to-container projection. The fit leader's
 * `baseScale` is computed from the reference's natural size; the other panel
 * mirrors it through the shared `ViewTransform`. The reference panel leads
 * when there is a content-fitting viewer (image/url/pexels/sketchfab in
 * fixed mode, or YouTube which has its own logical canvas). Otherwise the
 * drawing panel leads.
 *
 * Pure function with no React deps — easy to unit-test (see
 * splitLayoutHelpers.test.ts) and easy to extend if a new source type
 * arrives. Imported by SplitLayout, where it's the single source of truth.
 */
export function computeFitLeader(source: ReferenceSource, referenceMode: ReferenceMode): FitLeader {
  if (source === 'youtube') return 'reference';
  if (referenceMode === 'fixed' && (source === 'image' || source === 'url' || source === 'pexels' || source === 'sketchfab')) {
    return 'reference';
  }
  return 'drawing';
}

/**
 * Size that DrawingCanvas should fit-to-canvas. When the reference panel
 * leads, mirror the reference's size so strokes/grid project consistently.
 * When the drawing panel leads (free drawing or search screens), return null
 * so DrawingCanvas falls back to baseScale=1 — using the previous
 * reference's `referenceSize` here would project against an invisible old
 * image and cause the visual zoom to alternate as the user navigates between
 * the source picker and a search screen.
 */
export function resolveDrawingFitSize(
  fitLeader: FitLeader,
  referenceSize: { width: number; height: number } | null,
): { width: number; height: number } | null {
  return fitLeader === 'reference' ? referenceSize : null;
}
