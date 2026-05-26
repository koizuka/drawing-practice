import { vi } from 'vitest';
import { StrokeManager } from './StrokeManager';
import type { ReferenceSnapshot, Stroke } from './types';

function snap(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
  return {
    source: 'none',
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: null,
    ...overrides,
  };
}

describe('StrokeManager', () => {
  let manager: StrokeManager;

  beforeEach(() => {
    manager = new StrokeManager();
  });

  describe('stroke recording', () => {
    it('records a stroke with multiple points', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.appendStroke({ x: 20, y: 20 });
      const stroke = manager.endStroke();

      expect(stroke).not.toBeNull();
      expect(stroke!.points).toHaveLength(3);
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('discards strokes with fewer than 2 points', () => {
      manager.startStroke({ x: 0, y: 0 });
      const stroke = manager.endStroke();

      expect(stroke).toBeNull();
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('ignores appendStroke when no stroke is active', () => {
      manager.appendStroke({ x: 10, y: 10 });
      expect(manager.getCurrentStroke()).toBeNull();
    });

    it('cancelStroke discards the in-progress stroke without committing or affecting undo', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 5, y: 5 });
      manager.appendStroke({ x: 10, y: 10 });
      expect(manager.getCurrentStroke()!.points).toHaveLength(3);

      manager.cancelStroke();

      expect(manager.getCurrentStroke()).toBeNull();
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(false);

      // A subsequent endStroke must be a no-op (currentStroke already cleared)
      expect(manager.endStroke()).toBeNull();
      expect(manager.canUndo()).toBe(false);
    });

    it('cancelStroke is safe to call when no stroke is active', () => {
      expect(() => manager.cancelStroke()).not.toThrow();
      expect(manager.getCurrentStroke()).toBeNull();
      expect(manager.canUndo()).toBe(false);
    });

    it('cancelStroke does not disturb previously committed strokes or undo stack', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.canUndo()).toBe(true);

      manager.startStroke({ x: 100, y: 100 });
      manager.appendStroke({ x: 110, y: 110 });
      manager.cancelStroke();

      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.canUndo()).toBe(true);
      // The first (committed) stroke is still undoable
      const undone = manager.undo();
      expect(undone?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('tracks current stroke during drawing', () => {
      manager.startStroke({ x: 0, y: 0 });
      expect(manager.getCurrentStroke()).not.toBeNull();

      manager.appendStroke({ x: 10, y: 10 });
      expect(manager.getCurrentStroke()!.points).toHaveLength(2);

      manager.endStroke();
      expect(manager.getCurrentStroke()).toBeNull();
    });

    it('quantizes the start point to the 0.1px grid', () => {
      manager.startStroke({ x: 12.34567, y: -5.05 });
      expect(manager.getCurrentStroke()!.points[0]).toEqual({ x: 12.3, y: -5.1 });
    });

    it('quantizes appended points and skips duplicates that collapse onto the previous point', () => {
      manager.startStroke({ x: 12.34, y: 23.45 });
      manager.appendStroke({ x: 12.32, y: 23.46 }); // → (12.3, 23.5) duplicate, skipped
      manager.appendStroke({ x: 12.30, y: 23.49 }); // → (12.3, 23.5) duplicate, skipped
      manager.appendStroke({ x: 80, y: 80 });

      const points = manager.getCurrentStroke()!.points;
      expect(points).toEqual([
        { x: 12.3, y: 23.5 },
        { x: 80, y: 80 },
      ]);
    });

    it('keeps points that differ after quantization', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 0.04, y: 0.04 }); // → (0, 0) duplicate, skipped
      manager.appendStroke({ x: 0.06, y: 0.06 }); // → (0.1, 0.1) kept
      const stroke = manager.endStroke();
      expect(stroke!.points).toEqual([
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
      ]);
    });

    it('appendStroke returns true when the point is added and false on dedup-skip', () => {
      manager.startStroke({ x: 0, y: 0 });
      expect(manager.appendStroke({ x: 0.04, y: 0.04 })).toBe(false); // dedup of (0,0)
      expect(manager.appendStroke({ x: 0.06, y: 0.06 })).toBe(true); // (0.1, 0.1)
      expect(manager.appendStroke({ x: 0.08, y: 0.12 })).toBe(false); // dedup of (0.1, 0.1)
      expect(manager.appendStroke({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it('appendStroke returns false when no stroke is active', () => {
      expect(manager.appendStroke({ x: 1, y: 2 })).toBe(false);
    });

    it('endStroke returns the same quantized stroke that getStrokes exposes', () => {
      manager.startStroke({ x: 1.23, y: 4.56 });
      manager.appendStroke({ x: 7.89, y: 0.12 });
      const returned = manager.endStroke();
      expect(returned).not.toBeNull();
      expect(returned!.points).toEqual([
        { x: 1.2, y: 4.6 },
        { x: 7.9, y: 0.1 },
      ]);
      expect(manager.getStrokes()[0]).toBe(returned);
    });
  });

  describe('undo/redo', () => {
    it('undoes the last stroke', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      expect(manager.canUndo()).toBe(true);
      const undone = manager.undo();
      expect(undone).not.toBeNull();
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('redoes an undone stroke', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.undo();
      expect(manager.canRedo()).toBe(true);

      const redone = manager.redo();
      expect(redone).not.toBeNull();
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('clears redo stack when a new stroke is drawn', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.undo();
      expect(manager.canRedo()).toBe(true);

      manager.startStroke({ x: 5, y: 5 });
      manager.appendStroke({ x: 15, y: 15 });
      manager.endStroke();

      expect(manager.canRedo()).toBe(false);
    });

    it('returns null when nothing to undo/redo', () => {
      expect(manager.undo()).toBeNull();
      expect(manager.redo()).toBeNull();
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
    });
  });

  describe('discardLastStroke', () => {
    it('removes the most recent stroke without leaving an undo entry', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      const stroke = manager.endStroke();
      expect(stroke).not.toBeNull();
      expect(manager.canUndo()).toBe(true);

      const discarded = manager.discardLastStroke();
      expect(discarded).toBe(stroke);
      expect(manager.getStrokes()).toHaveLength(0);
      // No undo entry remains → Undo cannot resurrect the discarded stroke.
      expect(manager.canUndo()).toBe(false);
    });

    it('is a no-op when the top of the undo stack is not an add', () => {
      const snap: ReferenceSnapshot = {
        source: 'none',
        referenceMode: 'browse',
        fixedImageUrl: null,
        localImageUrl: null,
        referenceInfo: null,
      };
      manager.recordReferenceChange(snap);
      const result = manager.discardLastStroke();
      expect(result).toBeNull();
      expect(manager.canUndo()).toBe(true); // reference entry preserved
    });
  });

  describe('discardStrokes', () => {
    it('removes specified strokes by timestamp without leaving undo entries', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      const a = manager.endStroke()!;
      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      const b = manager.endStroke()!;
      manager.startStroke({ x: 40, y: 40 });
      manager.appendStroke({ x: 50, y: 50 });
      const c = manager.endStroke()!;

      const removed = manager.discardStrokes(new Set([a.timestamp, c.timestamp]));
      expect(removed).toBe(2);
      // Only b survives.
      expect(manager.getStrokes()).toEqual([b]);
      // Undoing the remaining add pops b — proves the undoStack stays
      // consistent with the surviving strokes.
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
      // After popping b, no more undo entries (a and c's adds were discarded
      // along with their strokes).
      expect(manager.canUndo()).toBe(false);
    });

    it('survives interleaved reference entries', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      const a = manager.endStroke()!;
      const snap: ReferenceSnapshot = {
        source: 'none',
        referenceMode: 'browse',
        fixedImageUrl: null,
        localImageUrl: null,
        referenceInfo: null,
      };
      manager.recordReferenceChange(snap);
      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      const b = manager.endStroke()!;

      const removed = manager.discardStrokes(new Set([a.timestamp]));
      expect(removed).toBe(1);
      expect(manager.getStrokes()).toEqual([b]);
      // Undo: should pop b's add first, then the reference entry. The
      // reference restorer isn't registered in this test, so it would
      // throw if called — but undoing add(b) just pops the stroke.
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('returns 0 when no timestamps match', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();
      const removed = manager.discardStrokes(new Set([99999]));
      expect(removed).toBe(0);
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('correctly identifies add entries by timestamp even after deleteStroke leaves stale add entries', () => {
      // Copilot regression: previously discardStrokes mapped "i-th live
      // stroke → i-th add entry by position", which silently removed the
      // wrong add entry once a deleteStroke had been issued.
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 1, y: 1 });
      manager.endStroke()!;
      manager.startStroke({ x: 10, y: 10 });
      manager.appendStroke({ x: 11, y: 11 });
      const b = manager.endStroke()!;
      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 21, y: 21 });
      const c = manager.endStroke()!;
      // Replace-via-delete (mimics trace re-trace): delete A. The add(A.ts)
      // entry remains in undoStack — index-based logic would have aligned
      // strokes[0]=B with addPositions[0]=add(A.ts), corrupting subsequent
      // undo behavior.
      manager.deleteStroke(0);
      expect(manager.getStrokes().map(s => s.timestamp)).toEqual([b.timestamp, c.timestamp]);

      // Discard B by timestamp. add(B.ts) must be the one that's removed,
      // not add(A.ts).
      const removed = manager.discardStrokes(new Set([b.timestamp]));
      expect(removed).toBe(1);
      expect(manager.getStrokes().map(s => s.timestamp)).toEqual([c.timestamp]);
    });

    it('drops delete entries that reference discarded strokes so Undo cannot resurrect them', () => {
      // Copilot regression: with the prior implementation, a leftover
      // delete-entry whose stroke had been discarded could be undone,
      // splicing a ghost stroke back into the manager.
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 1, y: 1 });
      const a = manager.endStroke()!;
      manager.startStroke({ x: 10, y: 10 });
      manager.appendStroke({ x: 11, y: 11 });
      const b = manager.endStroke()!;
      manager.deleteStroke(0); // A removed, delete-entry remembers A
      expect(manager.getStrokes().map(s => s.timestamp)).toEqual([b.timestamp]);

      // Discard both A and B (A is not in strokes anymore but is in history).
      manager.discardStrokes(new Set([a.timestamp, b.timestamp]));
      expect(manager.getStrokes()).toHaveLength(0);
      // Now Undo should NOT resurrect A.
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(false);
    });
  });

  describe('deleteStroke', () => {
    it('deletes a stroke by index', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      const deleted = manager.deleteStroke(0);
      expect(deleted).not.toBeNull();
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 });
    });

    it('returns null for invalid index', () => {
      expect(manager.deleteStroke(-1)).toBeNull();
      expect(manager.deleteStroke(0)).toBeNull();
    });

    it('clears redo stack on delete', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.undo();
      expect(manager.canRedo()).toBe(true);

      manager.deleteStroke(0);
      expect(manager.canRedo()).toBe(false);
    });

    it('can undo a delete operation', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.deleteStroke(0);
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.canUndo()).toBe(true);

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 });
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 });
    });

    it('undo after delete restores stroke at original index', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.startStroke({ x: 40, y: 40 });
      manager.appendStroke({ x: 50, y: 50 });
      manager.endStroke();

      // Delete middle stroke
      manager.deleteStroke(1);
      expect(manager.getStrokes()).toHaveLength(2);

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(3);
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 });
    });

    it('can undo multiple consecutive deletes', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.startStroke({ x: 40, y: 40 });
      manager.appendStroke({ x: 50, y: 50 });
      manager.endStroke();

      // Delete first, then second (now at index 0)
      manager.deleteStroke(0);
      manager.deleteStroke(0);
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 40, y: 40 });

      // Undo both deletes
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 });

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(3);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 });
    });

    it('undo interleaves add and delete in chronological order', () => {
      // Draw 3 strokes
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.startStroke({ x: 40, y: 40 });
      manager.appendStroke({ x: 50, y: 50 });
      manager.endStroke();

      // Delete middle stroke, then draw another
      manager.deleteStroke(1);
      expect(manager.getStrokes()).toHaveLength(2);

      manager.startStroke({ x: 60, y: 60 });
      manager.appendStroke({ x: 70, y: 70 });
      manager.endStroke();
      expect(manager.getStrokes()).toHaveLength(3);

      // Undo should reverse: remove last added, then restore deleted
      manager.undo(); // undo add of (60,60)
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 40, y: 40 });

      manager.undo(); // undo delete of (20,20)
      expect(manager.getStrokes()).toHaveLength(3);
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 });

      manager.undo(); // undo add of (40,40)
      expect(manager.getStrokes()).toHaveLength(2);
    });

    it('redo replays delete after undo', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      manager.deleteStroke(0);
      expect(manager.getStrokes()).toHaveLength(1);

      manager.undo(); // restore deleted stroke
      expect(manager.getStrokes()).toHaveLength(2);

      manager.redo(); // re-delete
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 });
    });

    it('new stroke clears delete undo', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.deleteStroke(0);
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(true);

      // Draw a new stroke — delete undo is lost
      manager.startStroke({ x: 50, y: 50 });
      manager.appendStroke({ x: 60, y: 60 });
      manager.endStroke();

      expect(manager.getStrokes()).toHaveLength(1);
      // Undo now undoes the new stroke, not the delete
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
    });
  });

  describe('lassoDelete', () => {
    function addStroke(x: number, y: number) {
      manager.startStroke({ x, y });
      manager.appendStroke({ x: x + 10, y: y + 10 });
      manager.endStroke();
    }

    it('deletes multiple strokes in a single undo entry', () => {
      addStroke(0, 0); // index 0
      addStroke(20, 20); // index 1
      addStroke(40, 40); // index 2
      addStroke(60, 60); // index 3

      const removed = manager.lassoDelete([0, 2]);
      expect(removed).not.toBeNull();
      expect(removed!).toHaveLength(2);
      expect(manager.getStrokes()).toHaveLength(2);
      // Remaining: original indices 1 and 3.
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 });
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 60, y: 60 });
    });

    it('returns null and skips history when nothing matches', () => {
      addStroke(0, 0);
      const before = manager.canUndo();
      const removed = manager.lassoDelete([]);
      expect(removed).toBeNull();
      expect(manager.canUndo()).toBe(before);

      const removed2 = manager.lassoDelete([5, 10, -1]);
      expect(removed2).toBeNull();
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('deduplicates and ignores out-of-range indices', () => {
      addStroke(0, 0);
      addStroke(20, 20);

      const removed = manager.lassoDelete([0, 0, 1, 5, -2]);
      expect(removed).toHaveLength(2);
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('undo restores all deleted strokes at their original indices', () => {
      addStroke(0, 0);
      addStroke(20, 20);
      addStroke(40, 40);
      addStroke(60, 60);

      manager.lassoDelete([0, 2]);
      expect(manager.getStrokes()).toHaveLength(2);

      const result = manager.undo();
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('strokes');
      expect(manager.getStrokes()).toHaveLength(4);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 });
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 });
      expect(manager.getStrokes()[2].points[0]).toEqual({ x: 40, y: 40 });
      expect(manager.getStrokes()[3].points[0]).toEqual({ x: 60, y: 60 });
    });

    it('redo re-applies the lasso delete after undo', () => {
      addStroke(0, 0);
      addStroke(20, 20);
      addStroke(40, 40);

      manager.lassoDelete([0, 1, 2]);
      expect(manager.getStrokes()).toHaveLength(0);

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(3);

      const result = manager.redo();
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('strokes');
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('survives multiple undo/redo cycles', () => {
      addStroke(0, 0);
      addStroke(20, 20);
      addStroke(40, 40);
      const before = manager.getStrokes().map(s => ({ ...s }));

      manager.lassoDelete([0, 2]);
      manager.undo();
      manager.redo();
      manager.undo();

      const after = manager.getStrokes();
      expect(after).toHaveLength(3);
      expect(after.map(s => s.points[0])).toEqual(before.map(s => s.points[0]));
    });

    it('clears the redo stack on a fresh lasso delete', () => {
      addStroke(0, 0);
      addStroke(20, 20);

      manager.undo(); // redo stack now has 1 entry
      expect(manager.canRedo()).toBe(true);

      manager.lassoDelete([0]);
      expect(manager.canRedo()).toBe(false);
    });

    it('interleaves correctly with stroke add and single delete', () => {
      addStroke(0, 0); // [s0]
      addStroke(20, 20); // [s0, s1]
      manager.lassoDelete([0]); // [s1]
      addStroke(40, 40); // [s1, s2]
      manager.deleteStroke(0); // [s2]
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 40, y: 40 });

      manager.undo(); // restore single delete -> [s1, s2]
      expect(manager.getStrokes()).toHaveLength(2);
      manager.undo(); // undo add s2 -> [s1]
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 });
      manager.undo(); // undo lasso -> [s0, s1]
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 });
    });
  });

  describe('findNearestStroke', () => {
    it('finds the nearest stroke within threshold', () => {
      manager.startStroke({ x: 100, y: 100 });
      manager.appendStroke({ x: 110, y: 110 });
      manager.endStroke();

      manager.startStroke({ x: 200, y: 200 });
      manager.appendStroke({ x: 210, y: 210 });
      manager.endStroke();

      const index = manager.findNearestStroke({ x: 105, y: 105 }, 20);
      expect(index).toBe(0);
    });

    it('returns null when no stroke is within threshold', () => {
      manager.startStroke({ x: 100, y: 100 });
      manager.appendStroke({ x: 110, y: 110 });
      manager.endStroke();

      const index = manager.findNearestStroke({ x: 500, y: 500 }, 20);
      expect(index).toBeNull();
    });
  });

  describe('loadState', () => {
    it('restores strokes and redo stack', () => {
      const strokes = [
        { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 },
        { points: [{ x: 20, y: 20 }, { x: 30, y: 30 }], timestamp: 2000 },
      ];
      const redoStack = [
        { points: [{ x: 40, y: 40 }, { x: 50, y: 50 }], timestamp: 3000 },
      ];

      manager.loadState(strokes, redoStack);

      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.getRedoStack()).toHaveLength(1);
      expect(manager.canUndo()).toBe(true);
      expect(manager.canRedo()).toBe(true);
    });

    it('clears current stroke on load', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.loadState([], []);

      expect(manager.getCurrentStroke()).toBeNull();
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('creates independent copies of input arrays', () => {
      const strokes = [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 }];
      manager.loadState(strokes, []);

      strokes.push({ points: [{ x: 20, y: 20 }, { x: 30, y: 30 }], timestamp: 2000 });
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('quantizes loaded strokes and redo stack', () => {
      const strokes = [
        { points: [{ x: 12.34, y: 23.45 }, { x: 12.32, y: 23.46 }, { x: 80, y: 80 }], timestamp: 1 },
      ];
      const redoStack = [
        { points: [{ x: 1.111, y: 2.222 }, { x: 5.555, y: 6.666 }], timestamp: 2 },
      ];
      manager.loadState(strokes, redoStack);

      expect(manager.getStrokes()[0].points).toEqual([
        { x: 12.3, y: 23.5 },
        { x: 80, y: 80 },
      ]);
      expect(manager.getRedoStack()[0].points).toEqual([
        { x: 1.1, y: 2.2 },
        { x: 5.6, y: 6.7 },
      ]);
    });
  });

  describe('getRedoStack', () => {
    it('returns empty redo stack initially', () => {
      expect(manager.getRedoStack()).toHaveLength(0);
    });

    it('returns redo stack after undo', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.undo();
      expect(manager.getRedoStack()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('removes all strokes and resets state', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.clear();
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
      expect(manager.getCurrentStroke()).toBeNull();
    });

    it('also discards reference history', () => {
      manager.setReferenceRestorer(vi.fn());
      manager.recordReferenceChange(snap({ source: 'none' }));
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.clear();
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
    });
  });

  describe('tentativeClear', () => {
    function commitStroke(m: StrokeManager, x: number, y: number): void {
      m.startStroke({ x, y });
      m.appendStroke({ x: x + 10, y: y + 10 });
      m.endStroke();
    }

    it('hides strokes but keeps them recoverable via undo', () => {
      commitStroke(manager, 0, 0);
      commitStroke(manager, 20, 20);

      const did = manager.tentativeClear();
      expect(did).toBe(true);
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.isTentativeClearActive()).toBe(true);
      expect(manager.canUndo()).toBe(true);

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.isTentativeClearActive()).toBe(false);
    });

    it('is a no-op when there are no strokes', () => {
      const did = manager.tentativeClear();
      expect(did).toBe(false);
      expect(manager.canUndo()).toBe(false);
      expect(manager.isTentativeClearActive()).toBe(false);
    });

    it('is a no-op when already tentative', () => {
      commitStroke(manager, 0, 0);
      manager.tentativeClear();
      const before = manager.canUndo();
      const did = manager.tentativeClear();
      expect(did).toBe(false);
      // Stack length unchanged — no second clear entry was added.
      expect(manager.canUndo()).toBe(before);
      expect(manager.isTentativeClearActive()).toBe(true);
    });

    it('drawing a new stroke commits the clear (saved strokes are discarded)', () => {
      commitStroke(manager, 0, 0);
      commitStroke(manager, 20, 20);
      manager.tentativeClear();

      commitStroke(manager, 100, 100);
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.isTentativeClearActive()).toBe(false);

      // Undo removes only the newly drawn stroke — the previously cleared
      // strokes are gone forever.
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(false);
    });

    it('commits even when a reference change sits between clear and new stroke', () => {
      manager.setReferenceRestorer(vi.fn());
      commitStroke(manager, 0, 0);
      manager.tentativeClear();
      manager.recordReferenceChange(snap({ source: 'image' }));
      // Drawing now must still commit the clear even though it's no longer on
      // top of the undo stack.
      commitStroke(manager, 50, 50);

      expect(manager.isTentativeClearActive()).toBe(false);
      // Stack from bottom: reference, add(new). The clear entry should be
      // gone. Undo pops add(new), then reference.
      manager.undo();
      expect(manager.getStrokes()).toHaveLength(0);
      manager.undo();
      // Reference restored; the cleared strokes are NOT recoverable anymore.
      expect(manager.canUndo()).toBe(false);
    });

    it('redo of clear re-enters tentative state', () => {
      commitStroke(manager, 0, 0);
      manager.tentativeClear();
      manager.undo();
      expect(manager.isTentativeClearActive()).toBe(false);
      expect(manager.getStrokes()).toHaveLength(1);

      manager.redo();
      expect(manager.isTentativeClearActive()).toBe(true);
      expect(manager.getStrokes()).toHaveLength(0);

      // From re-entered tentative state, drawing commits cleanly.
      commitStroke(manager, 100, 100);
      expect(manager.getStrokes()).toHaveLength(1);
      expect(manager.isTentativeClearActive()).toBe(false);
    });

    it('loadState clears tentative state', () => {
      commitStroke(manager, 0, 0);
      manager.tentativeClear();
      expect(manager.isTentativeClearActive()).toBe(true);

      manager.loadState([{ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], timestamp: 1 }], []);
      expect(manager.isTentativeClearActive()).toBe(false);
      expect(manager.getStrokes()).toHaveLength(1);
    });

    it('does NOT bump mutation count: Save → tentativeClear → Undo round-trips cleanly without flipping gallery-dirty', () => {
      // Regression coverage: prior to this guard, `tentativeClear()` and the
      // undo-of-clear path each called bumpMutation(), so the dirty flag
      // ratcheted past the saved value in both directions. Strokes were
      // bit-identical to the last save after Undo, yet
      // isDirtySinceGallerySave() returned true — letting Save (or Cmd+S)
      // write a duplicate gallery entry.
      commitStroke(manager, 0, 0);
      commitStroke(manager, 20, 20);
      manager.markSavedToGallery();
      expect(manager.isDirtySinceGallerySave()).toBe(false);

      manager.tentativeClear();
      expect(manager.isDirtySinceGallerySave()).toBe(false);

      manager.undo();
      expect(manager.getStrokes()).toHaveLength(2);
      expect(manager.isDirtySinceGallerySave()).toBe(false);

      // Redo back into tentative state — still not dirty.
      manager.redo();
      expect(manager.isTentativeClearActive()).toBe(true);
      expect(manager.isDirtySinceGallerySave()).toBe(false);
    });

    it('committing the tentative clear by drawing DOES bump gallery-dirty', () => {
      commitStroke(manager, 0, 0);
      manager.markSavedToGallery();
      expect(manager.isDirtySinceGallerySave()).toBe(false);

      manager.tentativeClear();
      expect(manager.isDirtySinceGallerySave()).toBe(false);

      // New stroke commits the tentative clear → endStroke bumps mutation.
      commitStroke(manager, 100, 100);
      expect(manager.isDirtySinceGallerySave()).toBe(true);
    });

    it('uses defensive copies — mutating this.strokes does not leak into the clear entries on the undo/redo stacks', () => {
      // Regression coverage: tentativeClear used to store this.strokes by
      // reference into both the undo entry AND the tentativeClearState. After
      // undo() of the clear, this.strokes and the redo entry's strokes
      // aliased the same array. Without defensive copies, an in-place mutation
      // of this.strokes between undo and redo would leak into the redo entry,
      // and redo would re-enter tentative with the polluted set.
      commitStroke(manager, 0, 0);
      const sentinelTimestamp = manager.getStrokes()[0].timestamp;
      manager.tentativeClear();
      manager.undo();
      // Force an in-place mutation of this.strokes that does NOT touch
      // redoStack (so any aliasing would persist). `(getStrokes() as Stroke[])`
      // bypasses the readonly type to push a synthetic sentinel directly into
      // the live array — the same effect a future refactor that preserves
      // redoStack across an add would have.
      const live = manager.getStrokes() as Stroke[];
      live.push({ points: [{ x: 999, y: 999 }, { x: 1000, y: 1000 }], timestamp: 99_999 });
      expect(manager.getStrokes()).toHaveLength(2);

      // Redo of clear must re-enter tentative with the ORIGINAL saved set
      // (1 stroke), NOT the polluted [original, sentinel] array.
      manager.redo();
      expect(manager.isTentativeClearActive()).toBe(true);
      expect(manager.getStrokes()).toHaveLength(0);

      manager.undo();
      const restored = manager.getStrokes();
      expect(restored).toHaveLength(1);
      expect(restored[0].timestamp).toBe(sentinelTimestamp);
      // The injected sentinel (timestamp 99_999) must NOT appear — it was
      // never part of the saved set, so independent-array storage drops it.
      expect(restored.find(s => s.timestamp === 99_999)).toBeUndefined();
    });
  });

  describe('reference history', () => {
    it('records a reference change in the undo stack', () => {
      expect(manager.canUndo()).toBe(false);
      manager.recordReferenceChange(snap({ source: 'none' }));
      expect(manager.canUndo()).toBe(true);
      expect(manager.canRedo()).toBe(false);
    });

    it('invokes the restorer with the previous snapshot on undo', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      const prev = snap({ source: 'none' });
      manager.recordReferenceChange(prev);

      const current = snap({ source: 'sketchfab', referenceMode: 'fixed', fixedImageUrl: 'data:current' });
      const result = manager.undo(() => current);

      expect(result).toEqual({ kind: 'reference' });
      expect(restorer).toHaveBeenCalledTimes(1);
      expect(restorer).toHaveBeenCalledWith(prev);
    });

    it('does not crash when undo pops a reference entry with no restorer set', () => {
      manager.recordReferenceChange(snap({ source: 'none' }));
      expect(() => manager.undo(() => snap())).not.toThrow();
      expect(manager.canUndo()).toBe(false);
    });

    it('redo re-applies the most recent snapshot after a reference undo', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      const prev = snap({ source: 'none' });
      const current = snap({ source: 'sketchfab', referenceMode: 'fixed', fixedImageUrl: 'data:A' });
      manager.recordReferenceChange(prev);

      manager.undo(() => current);
      expect(restorer).toHaveBeenLastCalledWith(prev);
      expect(manager.canRedo()).toBe(true);

      // After the undo, the "current" state is `prev`; redo pushes it back onto the undo stack
      manager.redo(() => prev);
      expect(restorer).toHaveBeenLastCalledWith(current);
      expect(manager.canRedo()).toBe(false);
      expect(manager.canUndo()).toBe(true);
    });

    it('does not call captureCurrentRef when undoing a stroke entry', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      const capture = vi.fn(() => snap());
      const result = manager.undo(capture);
      expect(result?.kind).toBe('stroke');
      expect(capture).not.toHaveBeenCalled();
    });

    it('calls captureCurrentRef exactly once when undoing a reference entry', () => {
      manager.recordReferenceChange(snap());

      const capture = vi.fn(() => snap({ source: 'image' }));
      manager.undo(capture);
      expect(capture).toHaveBeenCalledTimes(1);
    });

    it('undoes the initial reference load back to the none snapshot', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      const noneSnap = snap({ source: 'none' });
      manager.recordReferenceChange(noneSnap);

      const afterLoad = snap({ source: 'image', referenceMode: 'fixed', localImageUrl: 'data:img' });
      manager.undo(() => afterLoad);

      expect(restorer).toHaveBeenCalledWith(noneSnap);
    });

    it('undoes and redoes strokes and references in chronological order', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      const snapA = snap({ source: 'none' });
      const snapB = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:B' });
      const snapC = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:C' });

      // stroke1
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      // ref A → B
      manager.recordReferenceChange(snapA);

      // stroke2
      manager.startStroke({ x: 20, y: 20 });
      manager.appendStroke({ x: 30, y: 30 });
      manager.endStroke();

      // ref B → C
      manager.recordReferenceChange(snapB);

      // stroke3
      manager.startStroke({ x: 40, y: 40 });
      manager.appendStroke({ x: 50, y: 50 });
      manager.endStroke();

      expect(manager.getStrokes()).toHaveLength(3);

      // ---- Undo × 5 ----
      // 1: stroke3 removed
      expect(manager.undo(() => snapC)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(2);

      // 2: ref C → B (capture passes current snapC so redo can restore it)
      expect(manager.undo(() => snapC)?.kind).toBe('reference');
      expect(restorer).toHaveBeenLastCalledWith(snapB);

      // 3: stroke2 removed
      expect(manager.undo(() => snapB)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(1);

      // 4: ref B → A
      expect(manager.undo(() => snapB)?.kind).toBe('reference');
      expect(restorer).toHaveBeenLastCalledWith(snapA);

      // 5: stroke1 removed
      expect(manager.undo(() => snapA)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(0);
      expect(manager.canUndo()).toBe(false);

      // ---- Redo × 5 ----
      expect(manager.redo(() => snapA)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(1);

      expect(manager.redo(() => snapA)?.kind).toBe('reference');
      expect(restorer).toHaveBeenLastCalledWith(snapB);

      expect(manager.redo(() => snapB)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(2);

      expect(manager.redo(() => snapB)?.kind).toBe('reference');
      expect(restorer).toHaveBeenLastCalledWith(snapC);

      expect(manager.redo(() => snapC)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(3);
      expect(manager.canRedo()).toBe(false);
    });

    it('clears the redo stack when a new stroke is drawn after a reference undo', () => {
      manager.setReferenceRestorer(vi.fn());
      manager.recordReferenceChange(snap());
      manager.undo(() => snap({ source: 'image' }));
      expect(manager.canRedo()).toBe(true);

      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      expect(manager.canRedo()).toBe(false);
    });

    it('clears the redo stack when a new reference change is recorded after undo', () => {
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();
      manager.undo();
      expect(manager.canRedo()).toBe(true);

      manager.recordReferenceChange(snap());
      expect(manager.canRedo()).toBe(false);
    });

    it('interleaves deleteStroke and reference changes correctly', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      const snapA = snap({ source: 'none' });
      const snapB = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:B' });

      // Draw a stroke, then change ref A→B, then delete the stroke
      manager.startStroke({ x: 0, y: 0 });
      manager.appendStroke({ x: 10, y: 10 });
      manager.endStroke();

      manager.recordReferenceChange(snapA);

      manager.deleteStroke(0);
      expect(manager.getStrokes()).toHaveLength(0);

      // Undo #1: restore delete
      expect(manager.undo(() => snapB)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(1);

      // Undo #2: ref B → A
      expect(manager.undo(() => snapB)?.kind).toBe('reference');
      expect(restorer).toHaveBeenLastCalledWith(snapA);

      // Undo #3: remove the original stroke add
      expect(manager.undo(() => snapA)?.kind).toBe('stroke');
      expect(manager.getStrokes()).toHaveLength(0);
    });

    it('prunes the oldest reference entries when exceeding the history cap', () => {
      const restorer = vi.fn();
      manager.setReferenceRestorer(restorer);

      // Cap is 20. Record 25 reference changes; only the last 20 should survive.
      const snapshots: ReferenceSnapshot[] = [];
      for (let i = 0; i < 25; i++) {
        const s = snap({ source: 'image', fixedImageUrl: `data:${i}` });
        snapshots.push(s);
        manager.recordReferenceChange(s);
      }

      // Undo everything and collect the restored snapshots.
      const restored: ReferenceSnapshot[] = [];
      while (manager.canUndo()) {
        manager.undo(() => snap({ source: 'image' }));
      }
      for (const call of restorer.mock.calls) {
        restored.push(call[0] as ReferenceSnapshot);
      }

      // Should have 20 restorations in reverse chronological order: snapshots[24]..snapshots[5]
      expect(restored).toHaveLength(20);
      expect(restored[0]).toEqual(snapshots[24]);
      expect(restored[19]).toEqual(snapshots[5]);
    });

    it('loadState() does not populate reference history', () => {
      const restorer = vi.fn();
      const strokes = [
        { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 },
      ];
      manager.loadState(strokes, []);
      manager.setReferenceRestorer(restorer);

      // Only the stroke add should be in the undo stack; no reference entry
      const result = manager.undo(() => snap({ source: 'image' }));
      expect(result?.kind).toBe('stroke');
      expect(restorer).not.toHaveBeenCalled();
    });

    it('preserves stroke entries while pruning the oldest reference entry past the cap', () => {
      // Interleave: stroke, then 21 reference changes. The first reference
      // should be pruned, but the stroke must survive intact.
      manager.setReferenceRestorer(vi.fn());
      manager.startStroke({ x: 1, y: 1 });
      manager.appendStroke({ x: 2, y: 2 });
      manager.endStroke();

      for (let i = 0; i < 21; i++) {
        manager.recordReferenceChange(snap({ source: 'image', fixedImageUrl: `data:${i}` }));
      }

      // Undo everything and count kinds
      let strokeKinds = 0;
      let refKinds = 0;
      while (manager.canUndo()) {
        const r = manager.undo(() => snap({ source: 'image' }));
        if (r?.kind === 'stroke') strokeKinds++;
        if (r?.kind === 'reference') refKinds++;
      }

      expect(strokeKinds).toBe(1); // the stroke is kept
      expect(refKinds).toBe(20); // cap enforced, 1 ref pruned
    });

    it('keeps the reference count consistent when redo receives no captureCurrentRef', () => {
      manager.setReferenceRestorer(vi.fn());
      manager.recordReferenceChange(snap({ source: 'none' }));
      // Undo with a capture so the entry moves to the redo stack
      manager.undo(() => snap({ source: 'image', fixedImageUrl: 'data:A' }));

      // Redo WITHOUT a captureCurrentRef — the entry cannot be pushed back onto
      // the undo stack, so the count must not be incremented either.
      manager.redo();

      // Recording 20 more changes must succeed without pruneReferenceHistory
      // thinking the cap is already exceeded due to a stale count.
      for (let i = 0; i < 20; i++) {
        manager.recordReferenceChange(snap({ source: 'image', fixedImageUrl: `data:${i}` }));
      }

      // Exactly MAX_REFERENCE_HISTORY (20) reference entries should be in the
      // undo stack; 21 would mean the count was off by one.
      let refEntriesInStack = 0;
      while (manager.canUndo()) {
        const result = manager.undo(() => snap());
        if (result?.kind === 'reference') refEntriesInStack++;
      }
      expect(refEntriesInStack).toBe(20);
    });
  });
});
