import type { Point, ReferenceSnapshot, Stroke } from './types';
import { quantizePoint, quantizeStroke } from './quantize';

/** Maximum number of reference-change entries kept in history to bound memory. */
const MAX_REFERENCE_HISTORY = 20;

/**
 * One stroke deletion captured as part of a batch (lasso) erase. Stored with
 * its original index so undo can splice it back into the same slot.
 */
interface LassoDeleteItem {
  stroke: Stroke;
  index: number;
}

/** An entry on the undo stack records one reversible action. */
type UndoEntry
  = | { type: 'add' }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'lasso-delete'; items: LassoDeleteItem[] }
    | { type: 'reference'; prev: ReferenceSnapshot };

/** An entry on the redo stack stores enough data to replay the action. */
type RedoEntry
  = | { type: 'add'; stroke: Stroke }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'lasso-delete'; items: LassoDeleteItem[] }
    | { type: 'reference'; next: ReferenceSnapshot };

/** Result returned from undo()/redo() so callers can distinguish what changed. */
export type UndoResult
  = | { kind: 'stroke'; stroke: Stroke }
    | { kind: 'strokes'; strokes: Stroke[] }
    | { kind: 'reference' }
    | null;

/**
 * Function the SplitLayout registers to restore reference state when an
 * undo/redo operation pops a reference entry.
 */
export type ReferenceRestorer = (snapshot: ReferenceSnapshot) => void;

export class StrokeManager {
  private strokes: Stroke[] = [];
  private undoStack: UndoEntry[] = [];
  private redoStack: RedoEntry[] = [];
  private currentStroke: Stroke | null = null;
  private referenceRestorer: ReferenceRestorer | null = null;
  /** Number of reference entries currently in undoStack. Avoids O(n) scans during pruning. */
  private undoReferenceCount = 0;
  /**
   * Monotonic counter bumped on every stroke-modifying transition. Reference
   * undo entries do NOT bump it — they don't change the drawing the user
   * would save to the gallery. The gallery save button compares this against
   * `gallerySavedMutationCount` to decide whether anything has changed since
   * the last save (dirty check).
   */
  private mutationCount = 0;
  private gallerySavedMutationCount = 0;

  /**
   * Single funnel for "I just changed strokes." Every stroke-modifying exit
   * path calls this so future hooks (e.g. emitting a change event) only need
   * one site to wire into.
   */
  private bumpMutation(): void {
    this.mutationCount++;
  }

  // Invariant: every point stored in `currentStroke.points` and in
  // `this.strokes[]` is already snapped to the 0.1px grid (see ./quantize).
  // Points are quantized at the entry boundary (startStroke / appendStroke /
  // loadState) so downstream code — redraw, hit-test, autosave serialization,
  // undo/redo — all operate on the smaller, deduplicated point arrays without
  // needing to re-run quantization. endStroke is left as the place for any
  // future whole-stroke refinement (RDP simplification, smoothing, end-snap).

  startStroke(point: Point): void {
    this.currentStroke = {
      points: [quantizePoint(point)],
      timestamp: Date.now(),
    };
  }

  /**
   * Append a point to the in-progress stroke. Returns `true` if the point was
   * actually added, `false` if it was skipped (no active stroke, or the point
   * collapses onto the previous one after quantization). Callers can use the
   * return value to skip downstream work like canvas redraws when nothing
   * changed.
   */
  appendStroke(point: Point): boolean {
    if (!this.currentStroke) return false;
    const q = quantizePoint(point);
    const points = this.currentStroke.points;
    const last = points[points.length - 1];
    if (last.x === q.x && last.y === q.y) return false;
    points.push(q);
    return true;
  }

  endStroke(): Stroke | null {
    if (!this.currentStroke) return null;
    if (this.currentStroke.points.length < 2) {
      this.currentStroke = null;
      return null;
    }
    const stroke = this.currentStroke;
    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add' });
    this.redoStack = [];
    this.currentStroke = null;
    this.bumpMutation();
    return stroke;
  }

  /**
   * Discard the in-progress stroke without committing it or touching the
   * undo/redo stacks. Used when a multi-finger gesture takes over mid-stroke
   * so a stray short line is not left behind.
   */
  cancelStroke(): void {
    this.currentStroke = null;
  }

  getCurrentStroke(): Stroke | null {
    return this.currentStroke;
  }

  getStrokes(): readonly Stroke[] {
    return this.strokes;
  }

  /**
   * Register a callback invoked when undo/redo needs to restore a previous
   * reference state. The SplitLayout sets this once the StrokeManager is ready.
   */
  setReferenceRestorer(fn: ReferenceRestorer | null): void {
    this.referenceRestorer = fn;
  }

  /**
   * Record that the reference has just changed. `prev` is the snapshot taken
   * BEFORE the mutation so undo can restore it. Clears the redo stack and
   * prunes the oldest reference entry if the cap is exceeded.
   */
  recordReferenceChange(prev: ReferenceSnapshot): void {
    this.undoStack.push({ type: 'reference', prev });
    this.undoReferenceCount++;
    this.redoStack = [];
    this.pruneReferenceHistory();
  }

  private pruneReferenceHistory(): void {
    if (this.undoReferenceCount <= MAX_REFERENCE_HISTORY) return;

    // Remove the oldest reference entry (stroke entries are kept intact).
    const idx = this.undoStack.findIndex(e => e.type === 'reference');
    if (idx >= 0) {
      this.undoStack.splice(idx, 1);
      this.undoReferenceCount--;
    }
  }

  /**
   * Undo the most recent history entry.
   *
   * @param captureCurrentRef Called only when a reference entry is being
   * undone, to capture the CURRENT reference snapshot that should be pushed
   * onto the redo stack (so a subsequent redo can restore it).
   */
  undo(captureCurrentRef?: () => ReferenceSnapshot): UndoResult {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    if (entry.type === 'add') {
      const stroke = this.strokes.pop()!;
      this.redoStack.push({ type: 'add', stroke });
      this.bumpMutation();
      return { kind: 'stroke', stroke };
    }
    if (entry.type === 'delete') {
      this.strokes.splice(entry.index, 0, entry.stroke);
      this.redoStack.push({ type: 'delete', stroke: entry.stroke, index: entry.index });
      this.bumpMutation();
      return { kind: 'stroke', stroke: entry.stroke };
    }
    if (entry.type === 'lasso-delete') {
      // Re-insert in ascending index order so each splice() lands at the slot
      // the stroke originally occupied. items is stored ascending (see lassoDelete).
      const restored: Stroke[] = [];
      for (const item of entry.items) {
        this.strokes.splice(item.index, 0, item.stroke);
        restored.push(item.stroke);
      }
      this.redoStack.push({ type: 'lasso-delete', items: entry.items });
      this.bumpMutation();
      return { kind: 'strokes', strokes: restored };
    }
    // entry.type === 'reference'
    this.undoReferenceCount--;
    const current = captureCurrentRef?.();
    if (current) {
      this.redoStack.push({ type: 'reference', next: current });
    }
    this.referenceRestorer?.(entry.prev);
    return { kind: 'reference' };
  }

  /**
   * Redo the most recently undone entry.
   *
   * @param captureCurrentRef Called only when a reference entry is being
   * redone, to capture the CURRENT reference snapshot that should be pushed
   * back onto the undo stack.
   */
  redo(captureCurrentRef?: () => ReferenceSnapshot): UndoResult {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    if (entry.type === 'add') {
      this.strokes.push(entry.stroke);
      this.undoStack.push({ type: 'add' });
      this.bumpMutation();
      return { kind: 'stroke', stroke: entry.stroke };
    }
    if (entry.type === 'delete') {
      const [removed] = this.strokes.splice(entry.index, 1);
      this.undoStack.push({ type: 'delete', stroke: removed, index: entry.index });
      this.bumpMutation();
      return { kind: 'stroke', stroke: removed };
    }
    if (entry.type === 'lasso-delete') {
      // Re-delete in descending index order so earlier indices stay valid
      // throughout the splice loop.
      const removed: Stroke[] = [];
      for (let i = entry.items.length - 1; i >= 0; i--) {
        const [s] = this.strokes.splice(entry.items[i].index, 1);
        removed.push(s);
      }
      this.undoStack.push({ type: 'lasso-delete', items: entry.items });
      this.bumpMutation();
      return { kind: 'strokes', strokes: removed };
    }
    // entry.type === 'reference'
    const current = captureCurrentRef?.();
    if (current) {
      this.undoStack.push({ type: 'reference', prev: current });
      this.undoReferenceCount++;
    }
    this.referenceRestorer?.(entry.next);
    return { kind: 'reference' };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  deleteStroke(index: number): Stroke | null {
    if (index < 0 || index >= this.strokes.length) return null;
    const [removed] = this.strokes.splice(index, 1);
    this.undoStack.push({ type: 'delete', stroke: removed, index });
    this.redoStack = [];
    this.bumpMutation();
    return removed;
  }

  /**
   * Delete multiple strokes in a single undo entry. `indices` may be in any
   * order and may contain duplicates / out-of-range values (which are ignored).
   * Returns the deleted strokes in original (ascending-index) order, or `null`
   * when nothing was deleted (so callers can skip side effects like redraws).
   */
  lassoDelete(indices: readonly number[]): Stroke[] | null {
    const valid = Array.from(new Set(indices))
      .filter(i => i >= 0 && i < this.strokes.length)
      .sort((a, b) => a - b);
    if (valid.length === 0) return null;

    // Capture (stroke, original index) pairs in ascending-index order. Then
    // splice in descending order so earlier indices remain valid.
    const items: LassoDeleteItem[] = valid.map(index => ({
      stroke: this.strokes[index],
      index,
    }));
    for (let i = valid.length - 1; i >= 0; i--) {
      this.strokes.splice(valid[i], 1);
    }
    this.undoStack.push({ type: 'lasso-delete', items });
    this.redoStack = [];
    this.bumpMutation();
    return items.map(it => it.stroke);
  }

  /** Find the nearest stroke to a point within the given threshold distance. */
  findNearestStroke(point: Point, threshold: number): number | null {
    let bestIndex: number | null = null;
    let bestDist = threshold;

    for (let i = 0; i < this.strokes.length; i++) {
      const stroke = this.strokes[i];
      for (const p of stroke.points) {
        const dx = p.x - point.x;
        const dy = p.y - point.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }
    }

    return bestIndex;
  }

  loadState(strokes: Stroke[], redoStack: Stroke[]): void {
    // Quantize on entry so legacy session drafts and gallery loads land in the
    // same already-quantized state as freshly-drawn strokes.
    const quantizedStrokes = strokes.map(quantizeStroke);
    this.strokes = quantizedStrokes;
    this.undoStack = quantizedStrokes.map(() => ({ type: 'add' as const }));
    this.redoStack = redoStack.map(stroke => ({ type: 'add' as const, stroke: quantizeStroke(stroke) }));
    this.currentStroke = null;
    this.undoReferenceCount = 0;
    this.bumpMutation();
  }

  getRedoStack(): readonly Stroke[] {
    const result: Stroke[] = [];
    for (const e of this.redoStack) {
      if (e.type === 'add') result.push(e.stroke);
    }
    return result;
  }

  clear(): void {
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.currentStroke = null;
    this.undoReferenceCount = 0;
    this.bumpMutation();
  }

  /**
   * Record that the current stroke set has just been saved to the gallery.
   * After this call, `isDirtySinceGallerySave()` returns `false` until the
   * next stroke-modifying mutation.
   */
  markSavedToGallery(): void {
    this.gallerySavedMutationCount = this.mutationCount;
  }

  /** True when strokes have changed since the last `markSavedToGallery` call. */
  isDirtySinceGallerySave(): boolean {
    return this.mutationCount !== this.gallerySavedMutationCount;
  }
}
