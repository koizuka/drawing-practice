import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { TraceScoringProvider, useTraceScoring } from './TraceScoringContext';
import { StrokeManager } from '../drawing/StrokeManager';
import { circle, polyline } from '../templates/builders';
import type { Stroke } from '../drawing/types';
import type { TraceStroke } from './types';

function harness() {
  const sm = new StrokeManager();
  let api: ReturnType<typeof useTraceScoring> = null!;
  function Probe() {
    api = useTraceScoring();
    useEffect(() => { /* keep stable */ });
    return null;
  }
  render(
    <TraceScoringProvider>
      <Probe />
    </TraceScoringProvider>,
  );
  return {
    sm,
    get state() { return api; },
    setTemplate(strokes: readonly TraceStroke[] | null) {
      act(() => { api.setTemplate(strokes); });
    },
    finalize(stroke: Stroke) {
      // The test simulates the DrawingCanvas flow: the stroke is already in
      // the StrokeManager when handleStrokeFinalized is invoked.
      sm.startStroke(stroke.points[0]);
      for (let i = 1; i < stroke.points.length; i++) sm.appendStroke(stroke.points[i]);
      const committed = sm.endStroke();
      if (!committed) throw new Error('endStroke produced nothing');
      act(() => { api.handleStrokeFinalized(committed, sm); });
      return committed;
    },
  };
}

function ringTrace(r: number, n: number, startAngle = 0, dir: 1 | -1 = 1): Stroke {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = startAngle + dir * t * 2 * Math.PI;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return { points: pts, timestamp: Date.now() };
}

describe('TraceScoringContext', () => {
  it('accumulates strokes when each one matches a different template stroke', () => {
    const h = harness();
    const inner = circle(0, 0, 80, 96);
    const outer = circle(0, 0, 240, 96);
    h.setTemplate([inner, outer]);
    expect(h.state.totalCovered).toBe(0);

    h.finalize(ringTrace(80, 96));
    h.finalize(ringTrace(240, 96));

    expect(h.state.totalCovered).toBe(2);
    expect(h.state.totalStrokes).toBe(2);
    expect(h.sm.getStrokes()).toHaveLength(2);
  });

  it('re-tracing the same template stroke replaces the previous attempt visually but bumps the lifetime attempts count', () => {
    const h = harness();
    const target = circle(0, 0, 100, 96);
    h.setTemplate([target]);

    h.finalize(ringTrace(100, 96, 0, 1));
    h.finalize(ringTrace(100, 96, Math.PI / 2, -1));

    expect(h.state.totalCovered).toBe(1);
    // The stroke array holds only the most recent attempt; the prior is
    // deleted by the replacement path.
    expect(h.sm.getStrokes()).toHaveLength(1);
    // attempts is the monotonic lifetime count, so it goes 2 (preserves the
    // "I tried this twice" semantic across re-trace replacements).
    expect(h.state.scores[0].attempts).toBe(2);
  });

  it('discards strokes that do not match any template (out of endpoint tolerance)', () => {
    const h = harness();
    const target = circle(0, 0, 100, 96);
    h.setTemplate([target]);

    // A short far-away line — no endpoint near the ring, fails closure too.
    h.finalize({
      points: [{ x: 500, y: 500 }, { x: 510, y: 510 }],
      timestamp: Date.now(),
    });

    expect(h.state.totalCovered).toBe(0);
    expect(h.state.latestFeedback).toBeNull();
    expect(h.sm.getStrokes()).toHaveLength(0);
  });

  it('half-circle attempt against a closed template is rejected (closure tolerance)', () => {
    const h = harness();
    const target = circle(0, 0, 100, 96);
    h.setTemplate([target]);

    // Half-circle: pts from 0 to PI only.
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI;
      pts.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
    }
    h.finalize({ points: pts, timestamp: Date.now() });

    expect(h.state.totalCovered).toBe(0);
    expect(h.sm.getStrokes()).toHaveLength(0);
  });

  it('setTemplate clears scores, latest feedback, and the attempt map', () => {
    const h = harness();
    const target = circle(0, 0, 80, 96);
    h.setTemplate([target]);
    h.finalize(ringTrace(80, 96));
    expect(h.state.totalCovered).toBe(1);
    expect(h.state.latestFeedback).not.toBeNull();

    h.setTemplate([circle(0, 0, 50, 96)]);
    expect(h.state.totalCovered).toBe(0);
    expect(h.state.latestFeedback).toBeNull();
  });

  it('resetScores clears scores and removes the traced strokes from the manager but keeps the template active', () => {
    const h = harness();
    const target = circle(0, 0, 80, 96);
    h.setTemplate([target]);
    h.finalize(ringTrace(80, 96));
    expect(h.sm.getStrokes()).toHaveLength(1);

    act(() => { h.state.resetScores(h.sm); });

    expect(h.state.totalCovered).toBe(0);
    expect(h.state.latestFeedback).toBeNull();
    expect(h.state.templateStrokes).toEqual([target]);
    // Reset removes the user strokes that were tracked attempts.
    expect(h.sm.getStrokes()).toHaveLength(0);
  });

  it('resetScores is not undoable — Undo after a reset must not resurrect traced strokes as untracked ghosts', () => {
    // Regression for Copilot review #2. If resetScores used lassoDelete, Undo
    // would restore the strokes but the scoring history is already gone, so
    // a subsequent re-trace would not replace them and they would accumulate.
    const h = harness();
    h.setTemplate([circle(0, 0, 80, 96)]);
    h.finalize(ringTrace(80, 96));
    expect(h.sm.getStrokes()).toHaveLength(1);

    act(() => { h.state.resetScores(h.sm); });
    expect(h.sm.getStrokes()).toHaveLength(0);
    // No undoable entry was pushed by the reset itself. (Reference-change
    // entries may still exist from earlier setTemplate, but no stroke
    // entries.)
    h.sm.undo();
    expect(h.sm.getStrokes()).toHaveLength(0);
  });

  it('rejected attempts do not pollute the undo stack — Undo after a missed trace must not resurrect the rejected stroke', () => {
    // Regression for the original verifier finding #4. deleteStroke would
    // push a delete entry that Undo could pop to bring the stroke back as
    // an untracked ghost.
    const h = harness();
    h.setTemplate([circle(0, 0, 100, 96)]);

    // Draw far from the template — fails both endpoint and length checks.
    h.finalize({
      points: [{ x: 500, y: 500 }, { x: 600, y: 600 }],
      timestamp: 0,
    });
    expect(h.sm.getStrokes()).toHaveLength(0);
    expect(h.sm.canUndo()).toBe(false);
  });

  it('syncAttempts after Undo: lifetime attempts is preserved; score visibility tracks live strokes', () => {
    const h = harness();
    const target = circle(0, 0, 100, 96);
    h.setTemplate([target]);

    h.finalize(ringTrace(100, 96, 0, 1));
    h.finalize(ringTrace(100, 96, Math.PI / 2, -1));
    expect(h.sm.getStrokes()).toHaveLength(1);
    expect(h.state.scores[0].attempts).toBe(2);

    // Undo the replacement's delete entry → previous stroke reappears.
    act(() => { h.sm.undo(); h.state.syncAttempts(h.sm); });
    expect(h.sm.getStrokes()).toHaveLength(2);
    // Lifetime attempts is unchanged (the events happened, regardless of which
    // strokes are currently on canvas).
    expect(h.state.scores[0].attempts).toBe(2);

    // Undo away both attempts → the score entry disappears (no live stroke
    // backs it). Lifetime stats are preserved internally so a redo would
    // restore the displayed score.
    act(() => { h.sm.undo(); h.sm.undo(); h.state.syncAttempts(h.sm); });
    expect(h.sm.getStrokes()).toHaveLength(0);
    expect(h.state.totalCovered).toBe(0);
  });

  it('rejects pathologically-long user strokes whose endpoints happen to land near the template', () => {
    const h = harness();
    // 100px straight line template.
    const tpl = polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    h.setTemplate([tpl]);

    // Wild scribble whose start/end pass endpoint tolerance but whose total
    // length is ~5× the template.
    const pts: { x: number; y: number }[] = [];
    pts.push({ x: 0, y: 0 });
    for (let i = 0; i < 20; i++) {
      pts.push({ x: i * 5, y: (i % 2) * 80 });
    }
    pts.push({ x: 100, y: 0 });
    h.finalize({ points: pts, timestamp: 0 });

    // Should be rejected by the length-ratio guard.
    expect(h.state.totalCovered).toBe(0);
    expect(h.sm.getStrokes()).toHaveLength(0);
  });

  it('keeps best when a worse retrace lands on the same template stroke', () => {
    const h = harness();
    // Open template so we can craft a worse attempt easily by perturbing endpoints.
    const seg = polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    h.setTemplate([seg]);

    // Perfect trace
    h.finalize({
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      timestamp: Date.now(),
    });
    const firstBest = h.state.scores[0].bestErrorPct;

    // Slightly bowed retrace (still within endpoint tol)
    h.finalize({
      points: [{ x: 0, y: 0 }, { x: 50, y: 2 }, { x: 100, y: 0 }],
      timestamp: Date.now() + 1,
    });

    expect(h.state.scores[0].attempts).toBe(2);
    expect(h.state.scores[0].bestErrorPct).toBeCloseTo(firstBest, 5);
  });

  describe('attemptedStrokeTimestamps (re-trace visibility)', () => {
    it('reflects only currently-live scored attempts', () => {
      const h = harness();
      const inner = circle(0, 0, 80, 96);
      const outer = circle(0, 0, 240, 96);
      h.setTemplate([inner, outer]);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(0);

      const a = h.finalize(ringTrace(80, 96));
      expect(h.state.attemptedStrokeTimestamps.has(a.timestamp)).toBe(true);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(1);

      const b = h.finalize(ringTrace(240, 96));
      expect(h.state.attemptedStrokeTimestamps.has(b.timestamp)).toBe(true);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(2);
    });

    it('removes a timestamp when its stroke is undone, and restores it after redo+sync', () => {
      const h = harness();
      h.setTemplate([circle(0, 0, 80, 96)]);
      const a = h.finalize(ringTrace(80, 96));
      expect(h.state.attemptedStrokeTimestamps.has(a.timestamp)).toBe(true);

      act(() => { h.sm.undo(); h.state.syncAttempts(h.sm); });
      expect(h.state.attemptedStrokeTimestamps.has(a.timestamp)).toBe(false);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(0);

      act(() => { h.sm.redo(); h.state.syncAttempts(h.sm); });
      expect(h.state.attemptedStrokeTimestamps.has(a.timestamp)).toBe(true);
    });

    it('drops the previous attempt timestamp when re-trace replaces it', () => {
      const h = harness();
      h.setTemplate([circle(0, 0, 100, 96)]);
      const a = h.finalize(ringTrace(100, 96, 0, 1));
      const b = h.finalize(ringTrace(100, 96, Math.PI / 2, -1));
      // a was deleted by the replacement; only b is live.
      expect(h.state.attemptedStrokeTimestamps.has(a.timestamp)).toBe(false);
      expect(h.state.attemptedStrokeTimestamps.has(b.timestamp)).toBe(true);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(1);
    });

    it('is empty after setTemplate', () => {
      const h = harness();
      h.setTemplate([circle(0, 0, 80, 96)]);
      h.finalize(ringTrace(80, 96));
      expect(h.state.attemptedStrokeTimestamps.size).toBe(1);

      h.setTemplate([circle(0, 0, 50, 96)]);
      expect(h.state.attemptedStrokeTimestamps.size).toBe(0);
    });
  });

  describe('clearLatestFeedback', () => {
    it('wipes latestFeedback without touching scores or strokes', () => {
      const h = harness();
      h.setTemplate([circle(0, 0, 80, 96)]);
      h.finalize(ringTrace(80, 96));
      expect(h.state.latestFeedback).not.toBeNull();
      const prevScores = h.state.scores;
      const prevStrokeCount = h.sm.getStrokes().length;

      act(() => { h.state.clearLatestFeedback(); });

      expect(h.state.latestFeedback).toBeNull();
      // Scores + strokes unaffected; only the deviation overlay state is cleared.
      expect(h.state.scores).toEqual(prevScores);
      expect(h.sm.getStrokes()).toHaveLength(prevStrokeCount);
    });
  });
});
