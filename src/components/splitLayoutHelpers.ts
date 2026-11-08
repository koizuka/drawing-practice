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

  return (
    (source === 'sketchfab' && !sketchfabViewerActive) ||
    source === 'pexels' ||
    source === 'pose' ||
    source === 'trace-template'
  );
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
  if (
    referenceMode === 'fixed' &&
    (source === 'image' ||
      source === 'url' ||
      source === 'pexels' ||
      source === 'sketchfab' ||
      source === 'trace-template' ||
      source === 'pose')
  ) {
    return 'reference';
  }
  return 'drawing';
}

/**
 * URL of the fixed reference image that `ImageViewer` is showing, or null
 * when no fixed image is on screen. Single source of truth for both the
 * reference panel (which mounts `ImageViewer` on it) and the drawing-canvas
 * underlay (which draws the same bitmap faintly under the strokes), so the
 * underlay is available exactly when the fixed image is.
 *
 * - `image` + fixed → the local (data/blob) URL
 * - `url` / `pexels` / `sketchfab` / `pose` + fixed → `fixedImageUrl`
 *   (Sketchfab/pose Fix-Angle screenshots ride this same path)
 * - everything else → null: `youtube` (an iframe can't be drawn onto a
 *   canvas), `trace-template` (renders its own guide strokes), `none`, and
 *   every browse screen.
 */
export function resolveFixedImageUrl(
  source: ReferenceSource,
  referenceMode: ReferenceMode,
  fixedImageUrl: string | null,
  localImageUrl: string | null,
): string | null {
  if (referenceMode !== 'fixed') return null;
  switch (source) {
    case 'image':
      return localImageUrl;
    case 'url':
    case 'pexels':
    case 'sketchfab':
    case 'pose':
      return fixedImageUrl;
    default:
      return null;
  }
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

/**
 * The browse / picker screen of `source` with nothing loaded yet (`'none'` =
 * the source picker itself). Pass to `ReferenceSetters.setAll`.
 */
export function browseReference(source: ReferenceSource): ReferenceSnapshot {
  return {
    source,
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: null,
  };
}

/**
 * A loaded reference described by `info` — `source` is always `info.source`,
 * and the image URLs not given are cleared. Pass to `ReferenceSetters.setAll`.
 */
export function loadedReference(
  info: ReferenceInfo,
  referenceMode: ReferenceMode,
  images: { fixedImageUrl?: string | null; localImageUrl?: string | null } = {},
): ReferenceSnapshot {
  return {
    source: info.source,
    referenceMode,
    fixedImageUrl: images.fixedImageUrl ?? null,
    localImageUrl: images.localImageUrl ?? null,
    referenceInfo: info,
  };
}

/**
 * True when the active source mounts a viewer that reports
 * `onReferenceImageSize` and calls `loadContent(0, 0, 1)` once its content
 * loads (ImageViewer for fixed images, YouTubeViewer, TraceTemplateViewer).
 * Callers defer two things behind it: the legacy-coord stroke migration
 * (needs the size) and a camera restore (would be stomped by loadContent).
 *
 * Sketchfab / pose only go through ImageViewer with a captured screenshot
 * (`hasImage`); their browse modes (iframe / free-orbit 3D) do neither.
 */
export function referenceWillReportSize(source: ReferenceSource, hasImage: boolean): boolean {
  switch (source) {
    case 'image':
    case 'url':
    case 'pexels':
    case 'youtube':
    case 'trace-template':
      return true;
    case 'sketchfab':
    case 'pose':
      return hasImage;
    default:
      return false;
  }
}

/**
 * The `referenceImageData` the autosave draft stores for a reference: image
 * data that can't be re-fetched after a reload (local-file data URL, Sketchfab
 * / pose Fix-Angle screenshot). URL-backed sources store null — their
 * `referenceInfo` carries the URL. Inverse of {@link referenceStateFromDraft}.
 */
export function referenceImageDataOf(
  state: Pick<ReferenceSnapshot, 'source' | 'fixedImageUrl' | 'localImageUrl'>,
): string | null {
  if (state.source === 'image' && state.localImageUrl) return state.localImageUrl;
  if ((state.source === 'sketchfab' || state.source === 'pose') && state.fixedImageUrl) {
    return state.fixedImageUrl;
  }
  return null;
}

/**
 * Reference state to restore from an autosave draft. Mode / URL come from the
 * stored image data for image / sketchfab / pose, otherwise from
 * `referenceInfo` (url / pexels → fixed on their URL, trace-template → fixed
 * with no image, youtube → browse). Anything else lands in browse.
 */
export function referenceStateFromDraft(draft: {
  source: ReferenceSource;
  referenceInfo: ReferenceInfo | null;
  referenceImageData: string | null;
}): ReferenceSnapshot {
  if (draft.source === 'none') return browseReference('none');
  const info = draft.referenceInfo;
  const state: ReferenceSnapshot = {
    source: draft.source,
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: info,
  };
  const data = draft.referenceImageData;
  if (draft.source === 'image' && data) {
    return { ...state, referenceMode: 'fixed', localImageUrl: data };
  }
  if ((draft.source === 'sketchfab' || draft.source === 'pose') && data) {
    return { ...state, referenceMode: 'fixed', fixedImageUrl: data };
  }
  if (info?.source === 'url') {
    return { ...state, referenceMode: 'fixed', fixedImageUrl: info.imageUrl };
  }
  if (info?.source === 'pexels') {
    return { ...state, referenceMode: 'fixed', fixedImageUrl: info.pexelsImageUrl };
  }
  if (info?.source === 'trace-template') {
    // No image — the templateId is enough for ReferencePanel; just make sure
    // we land in fixed mode (otherwise the picker shows).
    return { ...state, referenceMode: 'fixed' };
  }
  return state; // youtube (browse) and anything without restorable content
}

/**
 * Reference state for a gallery record's `ReferenceInfo` ("Use this
 * reference" / "continue this drawing"), or null when the record doesn't
 * carry enough to restore it. Local-file images are NOT handled here — their
 * Blob comes asynchronously from URL history.
 */
export function referenceStateFromInfo(info: ReferenceInfo): ReferenceSnapshot | null {
  switch (info.source) {
    case 'sketchfab':
      if (!info.sketchfabUid) return null;
      // Without a screenshot, open the model in browse (the viewer loads it).
      return info.imageUrl
        ? loadedReference(info, 'fixed', { fixedImageUrl: info.imageUrl })
        : browseReference('sketchfab');
    case 'url':
      return info.imageUrl
        ? loadedReference(info, 'fixed', { fixedImageUrl: info.imageUrl })
        : null;
    case 'youtube':
      return info.youtubeVideoId ? loadedReference(info, 'browse') : null;
    case 'pexels':
      return info.pexelsImageUrl
        ? loadedReference(info, 'fixed', { fixedImageUrl: info.pexelsImageUrl })
        : null;
    case 'trace-template':
      return info.templateId ? loadedReference(info, 'fixed') : null;
    case 'pose':
      // The Fix-Angle screenshot restores straight into fixed mode; the pose
      // on the record revives the mannequin for "Change angle".
      return info.imageUrl
        ? loadedReference(info, 'fixed', { fixedImageUrl: info.imageUrl })
        : null;
    default:
      return null;
  }
}
