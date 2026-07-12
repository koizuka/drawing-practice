import type { PoseJson } from './pose/poseTypes';

export type ReferenceSource = 'none' | 'sketchfab' | 'image' | 'url' | 'youtube' | 'pexels' | 'trace-template' | 'pose';
export type ReferenceMode = 'browse' | 'fixed';

interface ReferenceInfoBase {
  title: string;
  author: string;
}

/**
 * Per-source reference metadata. Each variant lists the fields that are
 * actually meaningful for that source; everything is type-narrowed on
 * `source`, so utility code doesn't need optional-chain guards on fields that
 * are required for a given variant.
 */
export type ReferenceInfo
  = | (ReferenceInfoBase & {
    source: 'sketchfab';
    sketchfabUid: string;
    /** Screenshot data URL captured by "Fix This Angle". */
    imageUrl?: string;
  })
  | (ReferenceInfoBase & {
    source: 'image';
    fileName: string;
    /**
       * URL-history key (`local:<sha256>`) for this image. Present for entries
       * loaded after content-hash tracking was added; older drawings persist
       * without this field, in which case the gallery cannot reload them.
       */
    url?: string;
  })
  | (ReferenceInfoBase & {
    source: 'url';
    imageUrl: string;
  })
  | (ReferenceInfoBase & {
    source: 'youtube';
    youtubeVideoId: string;
  })
  | (ReferenceInfoBase & {
    source: 'pexels';
    pexelsPhotoId: number;
    pexelsImageUrl: string;
    pexelsPhotographerUrl?: string;
    pexelsPageUrl?: string;
  })
  | (ReferenceInfoBase & {
    source: 'trace-template';
    /** Bundled templates: 'bundle:<slug>'. External SVG support is future work. */
    templateId: string;
  })
  | (ReferenceInfoBase & {
    source: 'pose';
    /** Bundled registry key (see BUNDLED_VRMS) or 'user' for a user-loaded .vrm. */
    vrmId: string;
    /** Screenshot data URL captured by "Fix This Angle". */
    imageUrl?: string;
    /** LLM-generated pose applied to the mannequin. */
    pose?: PoseJson;
    /** User's one-line hint that accompanied the stick-figure sketch. */
    hint?: string;
  });

/**
 * Stable identity key for a reference. Used as a React `key` so that
 * reference-scoped UI state remounts when the user switches to a different
 * reference. Keyed on the per-variant unique identifier rather than on
 * title/author, so two different items that happen to share metadata do not
 * collide.
 */
export function referenceKey(info: ReferenceInfo): string {
  switch (info.source) {
    case 'sketchfab': return `sketchfab:${info.sketchfabUid}`;
    case 'image': return `image:${info.url ?? info.fileName}`;
    case 'url': return `url:${info.imageUrl}`;
    case 'youtube': return `youtube:${info.youtubeVideoId}`;
    case 'pexels': return `pexels:${info.pexelsPhotoId}`;
    case 'trace-template': return `trace-template:${info.templateId}`;
    // The pose JSON is part of the identity — two different generated poses
    // on the same mannequin are different references (gallery grouping,
    // overlay remount). JSON.stringify is deterministic here because
    // parsePoseJson rebuilds the object with a fixed key order.
    case 'pose': return `pose:${info.vrmId}:${info.pose ? JSON.stringify(info.pose) : ''}`;
  }
}
