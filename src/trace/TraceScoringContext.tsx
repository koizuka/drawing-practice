import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Stroke } from '../drawing/types';
import type { StrokeManager } from '../drawing/StrokeManager';
import { scoreAttempt, buildFeedback } from './scoring';
import type { TemplateScore, TraceFeedback, TraceStroke } from './types';

/**
 * Persistent record of every scored attempt, keyed by the user stroke's
 * timestamp. Derived state (attemptMap, scores) is rebuilt from the
 * intersection of this map with the currently-live strokes in the
 * StrokeManager — so undo/redo can be reflected by re-running syncAttempts.
 */
interface AttemptRecord {
  templateStrokeIdx: number;
  errorPct: number;
}

interface TraceScoringValue {
  /** Set the active template strokes; clears all scoring history. */
  setTemplate: (strokes: readonly TraceStroke[] | null) => void;
  /** Current per-template-stroke scores. */
  scores: readonly TemplateScore[];
  /** Latest deviation feedback, or null. */
  latestFeedback: TraceFeedback | null;
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
  /** Active template strokes (for canvas rendering). */
  templateStrokes: readonly TraceStroke[] | null;
}

const TraceScoringContext = createContext<TraceScoringValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useTraceScoring(): TraceScoringValue {
  const ctx = useContext(TraceScoringContext);
  if (!ctx) throw new Error('useTraceScoring must be inside a TraceScoringProvider');
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
}

/**
 * Derive the visible per-template-stroke scores.
 *
 * `allTimeStats` is the monotonic source of truth for `attempts` and
 * `bestErrorPct` (incremented on every scored attempt, including those later
 * deleted by a re-trace replacement). `history` ∩ `liveTimestamps` gates
 * visibility — a template idx is only surfaced as a score when at least
 * one of its attempt strokes is currently on the canvas. So replacing a
 * great attempt with a poorer one keeps `best` at the great score (the
 * great attempt actually happened), but undoing all the strokes for that
 * idx hides the score until the user redoes or re-traces.
 */
function computeScores(
  history: ReadonlyMap<number, AttemptRecord>,
  liveTimestamps: ReadonlySet<number>,
  allTimeStats: ReadonlyMap<number, { attempts: number; bestErrorPct: number }>,
): TemplateScore[] {
  const liveIdx = new Set<number>();
  for (const [ts, rec] of history) {
    if (liveTimestamps.has(ts)) liveIdx.add(rec.templateStrokeIdx);
  }
  const out: TemplateScore[] = [];
  for (const [idx, stat] of allTimeStats) {
    if (!liveIdx.has(idx)) continue;
    out.push({ templateStrokeIdx: idx, attempts: stat.attempts, bestErrorPct: stat.bestErrorPct });
  }
  return out.sort((a, b) => a.templateStrokeIdx - b.templateStrokeIdx);
}

function computeAttemptMap(
  history: ReadonlyMap<number, AttemptRecord>,
  liveTimestamps: ReadonlySet<number>,
): Map<number, number> {
  // For each templateStrokeIdx, the largest live timestamp wins (most recent
  // attempt). Used by handleStrokeFinalized to find the prior stroke to
  // replace on a re-trace.
  const map = new Map<number, number>();
  for (const [ts, rec] of history) {
    if (!liveTimestamps.has(ts)) continue;
    const prev = map.get(rec.templateStrokeIdx);
    if (prev === undefined || ts > prev) map.set(rec.templateStrokeIdx, ts);
  }
  return map;
}

export function TraceScoringProvider({ children }: ProviderProps) {
  const [templateStrokes, setTemplateStrokes] = useState<readonly TraceStroke[] | null>(null);
  const [scores, setScores] = useState<TemplateScore[]>([]);
  const [latestFeedback, setLatestFeedback] = useState<TraceFeedback | null>(null);

  // Append-only history of every scored attempt. Live derived state is
  // recomputed via computeScores / computeAttemptMap against the
  // StrokeManager's current strokes whenever syncAttempts runs.
  const attemptHistoryRef = useRef<Map<number, AttemptRecord>>(new Map());
  const attemptMapRef = useRef<Map<number, number>>(new Map());
  // Monotonic per-template-stroke aggregate. Survives re-trace replacements
  // (deleted strokes still contributed to "best"). Reset by setTemplate /
  // resetScores. See computeScores docstring for rationale.
  const allTimeStatsRef = useRef<Map<number, { attempts: number; bestErrorPct: number }>>(new Map());

  const setTemplate = useCallback((strokes: readonly TraceStroke[] | null) => {
    setTemplateStrokes(strokes);
    setScores([]);
    setLatestFeedback(null);
    // Template-idx values are template-relative, so history from a previous
    // template is meaningless against the new one. Strokes are intentionally
    // left in StrokeManager — the user may want to keep them as part of a
    // free drawing alongside the new template.
    attemptHistoryRef.current = new Map();
    attemptMapRef.current = new Map();
    allTimeStatsRef.current = new Map();
  }, []);

  const syncAttempts = useCallback((strokeManager: StrokeManager) => {
    const live = new Set<number>();
    for (const s of strokeManager.getStrokes()) live.add(s.timestamp);
    attemptMapRef.current = computeAttemptMap(attemptHistoryRef.current, live);
    setScores(computeScores(attemptHistoryRef.current, live, allTimeStatsRef.current));
    // Feedback is left untouched here — it represents the most-recent
    // attempt's deviation overlay and should persist until the next trace.
    // (handleStrokeFinalized calls syncAttempts immediately after setting
    // feedback; clearing here would clobber it via React batching.)
    // setTemplate, resetScores, and the DrawingPanel Clear button are the
    // explicit clear paths.
  }, []);

  const resetScores = useCallback((strokeManager: StrokeManager) => {
    // Pull the timestamps for traced strokes BEFORE clearing the history so
    // we know which strokes to erase from the manager.
    const tsToErase = new Set<number>(attemptHistoryRef.current.keys());
    attemptHistoryRef.current = new Map();
    attemptMapRef.current = new Map();
    allTimeStatsRef.current = new Map();
    setScores([]);
    setLatestFeedback(null);

    // Use discardStrokes (non-undoable) rather than lassoDelete: the user's
    // scoring history is already gone, so an Undo of the erase would
    // resurrect untracked ghost strokes that the scoring context has no
    // record of.
    if (tsToErase.size > 0) strokeManager.discardStrokes(tsToErase);
  }, []);

  const handleStrokeFinalized = useCallback((stroke: Stroke, strokeManager: StrokeManager) => {
    if (!templateStrokes || templateStrokes.length === 0) return;
    const match = scoreAttempt(stroke, templateStrokes);

    if (!match) {
      // Out-of-range: unwind the endStroke as if it never happened. This
      // bypasses the undo stack so a subsequent Undo can't resurrect the
      // rejected stroke as an untracked ghost.
      const top = strokeManager.getStrokes();
      if (top.length > 0 && top[top.length - 1].timestamp === stroke.timestamp) {
        strokeManager.discardLastStroke();
      }
      setLatestFeedback(null);
      return;
    }

    // Replace any previous attempt for this template stroke.
    const prevTs = attemptMapRef.current.get(match.templateStrokeIdx);
    if (prevTs !== undefined && prevTs !== stroke.timestamp) {
      const all = strokeManager.getStrokes();
      const prevIdx = all.findIndex(s => s.timestamp === prevTs);
      if (prevIdx >= 0) strokeManager.deleteStroke(prevIdx);
    }

    attemptHistoryRef.current.set(stroke.timestamp, {
      templateStrokeIdx: match.templateStrokeIdx,
      errorPct: match.errorPct,
    });
    // Update the monotonic stat — preserves best across re-trace replacements.
    const prev = allTimeStatsRef.current.get(match.templateStrokeIdx);
    allTimeStatsRef.current.set(match.templateStrokeIdx, {
      attempts: (prev?.attempts ?? 0) + 1,
      bestErrorPct: prev ? Math.min(prev.bestErrorPct, match.errorPct) : match.errorPct,
    });
    setLatestFeedback(buildFeedback(match));
    syncAttempts(strokeManager);
  }, [templateStrokes, syncAttempts]);

  const totalCovered = scores.length;
  const totalStrokes = templateStrokes?.length ?? 0;
  const overallBestPct = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.bestErrorPct, 0) / scores.length
    : null;

  const value = useMemo<TraceScoringValue>(() => ({
    setTemplate,
    scores,
    latestFeedback,
    totalCovered,
    totalStrokes,
    overallBestPct,
    handleStrokeFinalized,
    syncAttempts,
    resetScores,
    templateStrokes,
  }), [setTemplate, scores, latestFeedback, totalCovered, totalStrokes, overallBestPct, handleStrokeFinalized, syncAttempts, resetScores, templateStrokes]);

  return <TraceScoringContext.Provider value={value}>{children}</TraceScoringContext.Provider>;
}
