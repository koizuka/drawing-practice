import { isDefaultLayerState, type Layer, type LayerState } from './layers';
import { isDefaultFrameState, type FrameState, type FrameView } from './frames';

/** Layers + frames: the document-level state saved next to the strokes. */
export type DocSnapshot = LayerState & FrameState;

/** Optional storage fields (session draft and gallery record share the shape). */
export interface StoredDocFields {
  layers?: Layer[];
  activeLayerId?: string;
  frames?: string[];
  currentFrameId?: string;
  fps?: number;
}

/**
 * Storage fields for `doc`, omitting each part that is still at its default so
 * plain single-layer / single-frame drawings serialize exactly as before.
 */
export function docStateForStorage(doc: DocSnapshot | undefined): StoredDocFields {
  if (!doc) return {};
  const out: StoredDocFields = {};
  const ls: LayerState = { layers: doc.layers, activeLayerId: doc.activeLayerId };
  if (!isDefaultLayerState(ls)) {
    out.layers = doc.layers.map((l) => ({ ...l }));
    out.activeLayerId = doc.activeLayerId;
  }
  const fs: FrameState = { frames: doc.frames, currentFrameId: doc.currentFrameId, fps: doc.fps };
  if (!isDefaultFrameState(fs)) {
    out.frames = doc.frames.slice();
    out.currentFrameId = doc.currentFrameId;
    out.fps = doc.fps;
  }
  return out;
}

/** True when the stored fields carry anything (used to keep an otherwise-empty draft). */
export function hasStoredDocFields(f: StoredDocFields): boolean {
  return f.layers !== undefined || f.frames !== undefined;
}

/** Frame filter for rendering a stored record (undefined ⇒ single-frame data, no filter). */
export function storedFrameView(f: StoredDocFields): FrameView | undefined {
  if (!f.frames || f.frames.length === 0) return undefined;
  const frameId =
    f.currentFrameId && f.frames.includes(f.currentFrameId) ? f.currentFrameId : f.frames[0];
  return { frames: f.frames, frameId };
}

/** Pick the doc fields out of a stored record / draft (for StrokeManager.loadState). */
export function pickStoredDocFields(f: StoredDocFields): StoredDocFields | undefined {
  const picked: StoredDocFields = {};
  if (f.layers) {
    picked.layers = f.layers;
    picked.activeLayerId = f.activeLayerId;
  }
  if (f.frames) {
    picked.frames = f.frames;
    picked.currentFrameId = f.currentFrameId;
    picked.fps = f.fps;
  }
  return hasStoredDocFields(picked) ? picked : undefined;
}
