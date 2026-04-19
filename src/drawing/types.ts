import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types'

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  points: Point[]
  timestamp: number
}

/**
 * Snapshot of all reference-related state at a point in time.
 * Used by StrokeManager to record reference changes in the undo/redo history,
 * so the user can revert an unintended reference change (e.g. Fix Angle retake,
 * image swap, Close, Gallery load) back to the previous reference.
 */
export interface ReferenceSnapshot {
  source: ReferenceSource
  referenceMode: ReferenceMode
  fixedImageUrl: string | null
  localImageUrl: string | null
  referenceInfo: ReferenceInfo | null
}
