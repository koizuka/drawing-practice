import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  timestamp: number;
  /**
   * Layer this stroke belongs to (see src/drawing/layers.ts). Absent ≡ the
   * default layer, so pre-layer data and single-layer drawings are unchanged.
   */
  layerId?: string;
  /**
   * Animation frame this stroke belongs to (see src/drawing/frames.ts).
   * Absent ≡ the default frame; ignored for strokes on a `shared` layer.
   */
  frameId?: string;
}

/**
 * Snapshot of all reference-related state at a point in time.
 * Used by StrokeManager to record reference changes in the undo/redo history,
 * so the user can revert an unintended reference change (e.g. Fix Angle retake,
 * image swap, Close, Gallery load) back to the previous reference.
 */
export interface ReferenceSnapshot {
  source: ReferenceSource;
  referenceMode: ReferenceMode;
  fixedImageUrl: string | null;
  localImageUrl: string | null;
  referenceInfo: ReferenceInfo | null;
}
