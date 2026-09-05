import { createContext } from 'react';
import type { Stroke } from '../drawing/types';
import type { StrokeManager } from '../drawing/StrokeManager';
import type { TemplateScore, TraceFeedback, TraceStroke } from './types';

export interface TraceScoringValue {
  /** Set the active template strokes; clears all scoring history. */
  setTemplate: (strokes: readonly TraceStroke[] | null) => void;
  /** Current per-template-stroke scores. */
  scores: readonly TemplateScore[];
  /** Latest deviation feedback, or null. */
  latestFeedback: TraceFeedback | null;
  /**
   * Set of `Stroke.timestamp` values for currently-live strokes that are
   * scored attempts. The drawing canvas dims these so the template guide
   * stays readable underneath when the user starts re-tracing. A stroke
   * leaves the set when undone or otherwise removed from the manager.
   */
  attemptedStrokeTimestamps: ReadonlySet<number>;
  /** Total number of template strokes attempted at least once. */
  totalCovered: number;
  /** Total number of template strokes. */
  totalStrokes: number;
  /** Average best errorPct across attempted strokes (lower = better). null if none yet. */
  overallBestPct: number | null;
  /**
   * Handle a finalized user stroke. If a template is active, score it and
   * either replace the previous attempt for that template stroke (if any) or
   * remove the just-added stroke entirely when the attempt didn't qualify.
   * No-op when no template is active.
   */
  handleStrokeFinalized: (stroke: Stroke, strokeManager: StrokeManager) => void;
  /**
   * Rebuild scores from the intersection of attempt history with the
   * StrokeManager's currently-live strokes. Call this whenever strokes are
   * mutated outside `handleStrokeFinalized` (undo, redo, lasso erase, tap
   * erase). Without it the attempt map keeps stale timestamps and re-traces
   * fail to replace the previous attempt.
   */
  syncAttempts: (strokeManager: StrokeManager) => void;
  /**
   * Clear scores and remove all user strokes the scoring history is tracking.
   * Strokes the user drew before the template was loaded (or strokes that
   * never scored against the current template) are preserved.
   */
  resetScores: (strokeManager: StrokeManager) => void;
  /**
   * Wipe `latestFeedback`. Used by DrawingCanvas's pen-mode pointer-down
   * handler so the red deviation bands disappear the instant the user
   * starts a new stroke — they're noise during a re-trace.
   */
  clearLatestFeedback: () => void;
  /** Active template strokes (for canvas rendering). */
  templateStrokes: readonly TraceStroke[] | null;
}

// Kept out of TraceScoringContext.tsx so that file exports only the
// TraceScoringProvider component (react-refresh/only-export-components).
export const TraceScoringContext = createContext<TraceScoringValue | null>(null);
