import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types';
import type { ReferenceSnapshot } from '../drawing/types';

export type FitLeader = 'reference' | 'drawing';

/**
 * Whether a reference browse screen should temporarily occupy the full
 * viewport in portrait layouts. Content viewers stay split so their visible
 * framing continues to match the drawing panel; browse/picker/editor screens
 * need the extra vertical space to remain usable on phones.
 */
export function shouldFullscreenReferenceBrowse(
  isLandscape: boolean,
  source: ReferenceSource,
  referenceMode: ReferenceMode,
  sketchfabViewerActive: boolean,
): boolean {
  if (isLandscape || referenceMode !== 'browse') return false;

  return (source === 'sketchfab' && !sketchfabViewerActive)
    || source === 'pexels'
    || source === 'pose'
    || source === 'trace-template';
}

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
  if (referenceMode === 'fixed' && (source === 'image' || source === 'url' || source === 'pexels' || source === 'sketchfab' || source === 'trace-template' || source === 'pose')) {
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

/**
 * Whether loading `ref` (a gallery record's reference) would put the SAME
 * content on screen that `prev` (the reference state before the load) was
 * already displaying.
 *
 * Why this matters: the gallery "continue this drawing" load of a
 * legacy-coord record defers its stroke migration until the viewer reports
 * the reference's natural size (`onReferenceImageSize`). Viewers only fire
 * that on an actual content (re)load — if the applied reference resolves to
 * the identical src/videoId/template, React sees unchanged props, nothing
 * reloads, and the deferred strokes would wait forever. In the same-content
 * case the current `referenceSize` is already the right size, so the caller
 * migrates immediately instead of deferring.
 */
export function isSameReferenceContent(prev: ReferenceSnapshot, ref: ReferenceInfo): boolean {
  if (prev.source !== ref.source) return false;
  const prevInfo = prev.referenceInfo;
  switch (ref.source) {
    case 'url':
      return !!ref.imageUrl && prev.fixedImageUrl === ref.imageUrl;
    case 'pexels':
      return !!ref.pexelsImageUrl && prev.fixedImageUrl === ref.pexelsImageUrl;
    case 'sketchfab':
    case 'pose':
      return !!ref.imageUrl && prev.fixedImageUrl === ref.imageUrl;
    case 'image':
      // Local images are re-read from the history Blob into a data URL, so
      // compare the stable content-hash key instead of the volatile data URL.
      return !!ref.url && prevInfo?.source === 'image' && prevInfo.url === ref.url;
    case 'youtube':
      return prevInfo?.source === 'youtube' && prevInfo.youtubeVideoId === ref.youtubeVideoId;
    case 'trace-template':
      return prevInfo?.source === 'trace-template' && prevInfo.templateId === ref.templateId;
    default:
      return false;
  }
}
