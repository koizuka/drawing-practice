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

/**
 * An entry on the undo stack records one reversible action.
 *
 * `add` carries the added stroke's `timestamp` so that programmatic
 * cleanup paths (e.g. `discardStrokes`) can locate the matching entry by
 * stroke identity rather than by position. Without this, an `add` entry's
 * position in the undo stack diverges from its corresponding stroke's
 * position in `strokes[]` as soon as a `delete` or `lasso-delete` runs
 * (the `add` stays but the stroke is gone), and index-based filtering
 * silently removes the wrong entry.
 */
type UndoEntry
  = | { type: 'add'; timestamp: number }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'lasso-delete'; items: LassoDeleteItem[] }
    | { type: 'reference'; prev: ReferenceSnapshot }
    | { type: 'clear'; strokes: Stroke[] };

/** An entry on the redo stack stores enough data to replay the action. */
type RedoEntry
  = | { type: 'add'; stroke: Stroke }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'lasso-delete'; items: LassoDeleteItem[] }
    | { type: 'reference'; next: ReferenceSnapshot }
    | { type: 'clear'; strokes: Stroke[] };

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
   * Latest timestamp handed out for a stroke this session. `startStroke` uses
   * `max(Date.now(), lastIssuedTimestamp + 1)` so consecutive strokes always
   * get strictly-monotonic timestamps even when the wall clock returns the
   * same `Date.now()` value (tight test loops, low-resolution clocks). The
   * `Stroke.timestamp` field doubles as a stable per-session identity key
   * (used e.g. by trace-template scoring to swap re-traced attempts), so
   * collisions would silently break that mapping.
   */
  private lastIssuedTimestamp = 0;
  /**
   * When non-null, the canvas appears empty but the strokes that were live at
   * the moment of `tentativeClear()` are preserved on the undo stack as a
   * `'clear'` entry so the user can Undo back. Drawing a new stroke commits
   * the clear (drops the entry, discarding the saved strokes). Reference
   * changes between `tentativeClear` and the next `endStroke` keep the
   * tentative state alive — `endStroke` scans the stack for the clear entry
   * rather than assuming it sits at the top.
   */
  private tentativeClearState: { savedStrokes: Stroke[] } | null = null;

  private nextTimestamp(): number {
    const now = Date.now();
    const ts = now > this.lastIssuedTimestamp ? now : this.lastIssuedTimestamp + 1;
    this.lastIssuedTimestamp = ts;
    return ts;
  }

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
      timestamp: this.nextTimestamp(),
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
    // Commit any active tentative clear: the user is starting a new direction,
    // so the saved strokes are discarded permanently. Drop the `'clear'` entry
    // AND any older `add` / `delete` / `lasso-delete` entries that referenced
    // those strokes — keeping them would leave the undo stack inconsistent
    // (they'd point at strokes no longer in `this.strokes`).
    if (this.tentativeClearState !== null) {
      this.commitTentativeClear();
    }
    const stroke = this.currentStroke;
    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add', timestamp: stroke.timestamp });
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

  /**
   * Soft clear: hide all strokes from the canvas but keep them recoverable via
   * Undo. Pushes a `'clear'` entry onto the undo stack. Drawing a new stroke
   * (via `endStroke`) commits the clear by removing the entry, permanently
   * discarding the saved strokes. While tentative, repeated calls are no-ops
   * and `strokes.length === 0` is also a no-op (nothing to clear).
   *
   * **Why not just `clear()`**: the destructive `clear()` wipes the entire
   * undo/redo stack and is used by the gesture-session per-pose advance where
   * Undo recovery is undesirable. `tentativeClear()` is the trash-button /
   * reference-change path where the user expects "I changed my mind" to work.
   *
   * Returns `true` if a clear actually happened (caller may want to redraw),
   * `false` if it was a no-op.
   */
  tentativeClear(): boolean {
    if (this.tentativeClearState !== null) return false;
    if (this.strokes.length === 0) return false;
    // Defensive copy: keep `this.strokes`, the undo entry, and the tentative-
    // state record on independent arrays. Sharing the reference would alias
    // through `undo()` of `'clear'` (which restores `this.strokes = entry.strokes`),
    // making future stroke mutations leak into the entry. Today that's masked
    // only by `endStroke`'s `redoStack = []` running before any observer; a
    // copy makes the invariant local and survives refactors.
    const saved = this.strokes.slice();
    this.undoStack.push({ type: 'clear', strokes: saved });
    this.strokes = [];
    this.currentStroke = null;
    this.redoStack = [];
    this.tentativeClearState = { savedStrokes: saved };
    // Intentionally NOT calling bumpMutation: tentative clear is fully
    // reversible until the next `endStroke` commits it, so it must not flip
    // `gallerySaveDirty`. Without this guard, Save → Trash → Undo would leave
    // dirty=true while strokes are bit-identical to the saved set, allowing
    // duplicate gallery entries. The commit path (`endStroke`) bumps mutation
    // when it actually attaches the new stroke.
    return true;
  }

  isTentativeClearActive(): boolean {
    return this.tentativeClearState !== null;
  }

  /**
   * Commit the active tentative clear: drop the `'clear'` undo entry AND any
   * pre-clear entries (`add` / `delete` / `lasso-delete`) that referenced the
   * cleared strokes. After this, `this.strokes` (whatever the caller is about
   * to push) is consistent with the undo stack — no entry references a stroke
   * that doesn't exist anymore. No-op when not in tentative state.
   */
  private commitTentativeClear(): void {
    if (this.tentativeClearState === null) return;
    const clearedTimestamps = new Set(
      this.tentativeClearState.savedStrokes.map(s => s.timestamp),
    );
    const survived: UndoEntry[] = [];
    for (const e of this.undoStack) {
      if (e.type === 'clear') continue; // our own entry — drop it
      if (e.type === 'add') {
        if (!clearedTimestamps.has(e.timestamp)) survived.push(e);
        continue;
      }
      if (e.type === 'delete') {
        if (!clearedTimestamps.has(e.stroke.timestamp)) survived.push(e);
        continue;
      }
      if (e.type === 'lasso-delete') {
        const remainingItems = e.items.filter(it => !clearedTimestamps.has(it.stroke.timestamp));
        if (remainingItems.length === 0) continue;
        survived.push({ type: 'lasso-delete', items: remainingItems });
        continue;
      }
      // reference entries unaffected
      survived.push(e);
    }
    this.undoStack = survived;
    this.tentativeClearState = null;
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
    if (entry.type === 'clear') {
      // Defensive copy on restore + redo push: keep `this.strokes` independent
      // from the historical entry so subsequent stroke mutations cannot leak
      // backwards into the redo entry. (See the matching note in
      // `tentativeClear()`.)
      this.strokes = entry.strokes.slice();
      this.tentativeClearState = null;
      this.redoStack.push({ type: 'clear', strokes: entry.strokes });
      // Intentionally NOT bumpMutation: undoing a clear restores the strokes
      // to exactly the saved set, so gallery-dirty must not flip. This
      // mirrors the no-bump in `tentativeClear()` and lets Save → Trash →
      // Undo round-trip cleanly without triggering a duplicate gallery save.
      return { kind: 'strokes', strokes: this.strokes };
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
      this.undoStack.push({ type: 'add', timestamp: entry.stroke.timestamp });
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
    if (entry.type === 'clear') {
      // Defensive copy: the new tentative-state record gets an independent
      // array from the undo entry, mirroring `tentativeClear()`'s guarantee.
      const saved = entry.strokes.slice();
      this.undoStack.push({ type: 'clear', strokes: entry.strokes });
      this.strokes = [];
      this.currentStroke = null;
      this.tentativeClearState = { savedStrokes: saved };
      // No bumpMutation — re-entering tentative is the inverse of undo-of-clear
      // and must preserve gallery-dirty parity. See `tentativeClear()`.
      return { kind: 'strokes', strokes: [] };
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
   * Bulk-discard strokes by timestamp without pushing any undo entry. Finds
   * each `add` entry whose `timestamp` matches a discarded stroke and
   * removes it; also drops `delete` and `lasso-delete` entries that
   * reference any discarded stroke (their saved indices would become stale
   * once the stroke list shrinks).
   *
   * **Side effect**: clears the redo stack and prunes any `reference`
   * entries' tracking counters that lose their pair. Effectively any
   * `delete`/`lasso-delete` entry that *survives* must reference only
   * still-live strokes; in practice the resetScores caller's strokes are
   * typically the most recent thing in history, so the surviving stack is
   * either empty or contains only reference entries.
   *
   * Returns the number of strokes actually removed.
   *
   * **Why this isn't `lassoDelete`**: `lassoDelete` pushes a `lasso-delete`
   * undo entry so the user can recover an accidental erase. Programmatic
   * resets (e.g. trace-template scoring reset) want the strokes gone for
   * good — an undoable bulk delete would let the user resurrect strokes
   * whose scoring history has already been cleared, leaving untracked
   * ghosts that break re-trace replacement.
   */
  discardStrokes(timestamps: ReadonlySet<number>): number {
    if (timestamps.size === 0 || this.strokes.length === 0) return 0;
    const before = this.strokes.length;
    this.strokes = this.strokes.filter(s => !timestamps.has(s.timestamp));
    const removed = before - this.strokes.length;
    if (removed === 0) return 0;
    // Drop matching add entries (by timestamp — robust to interleaved
    // deletes that shift positional alignment), plus any delete /
    // lasso-delete entries that reference discarded strokes (otherwise
    // their saved indices would point at stale slots).
    const survived: UndoEntry[] = [];
    for (const e of this.undoStack) {
      if (e.type === 'add') {
        if (!timestamps.has(e.timestamp)) survived.push(e);
        continue;
      }
      if (e.type === 'delete') {
        if (!timestamps.has(e.stroke.timestamp)) survived.push(e);
        continue;
      }
      if (e.type === 'lasso-delete') {
        const remainingItems = e.items.filter(it => !timestamps.has(it.stroke.timestamp));
        if (remainingItems.length === 0) continue;
        survived.push({ type: 'lasso-delete', items: remainingItems });
        continue;
      }
      // reference / clear entries unaffected. (clear entries may carry stroke
      // references whose scoring has been wiped — Undo restores them as
      // untracked ghosts. Documented MVP limitation.)
      survived.push(e);
    }
    this.undoStack = survived;
    // Recompute the reference-entry counter from scratch — the loop above
    // may have dropped non-reference entries while leaving reference ones in
    // place, but `undoReferenceCount` should still equal the number of
    // surviving reference entries (pruning logic relies on this).
    this.undoReferenceCount = this.undoStack.filter(e => e.type === 'reference').length;
    // Pending redos may have been pointing at discarded strokes; safer to
    // drop them than risk a redo splicing back a stale stroke.
    this.redoStack = [];
    this.bumpMutation();
    return removed;
  }

  /**
   * Unwind the most recent `endStroke` as if it never happened: pops the
   * stroke off `strokes` AND removes the matching `add` entry from the undo
   * stack, leaving no trace for `undo()` to resurrect.
   *
   * **Why this isn't `deleteStroke`**: `deleteStroke` pushes a `delete` entry
   * so the user can recover an accidental erase. For programmatic rejections
   * (e.g. trace-template scoring discarding an out-of-range attempt), an
   * undo would resurrect the rejected stroke as an untracked ghost, then the
   * next retrace would mis-replace it. Use this instead when the stroke
   * should be treated as if the user never lifted the pen on it.
   *
   * Returns the discarded stroke for diagnostics, or `null` if the top of
   * the undo stack isn't an `add` (i.e. the stroke wasn't the most recent
   * thing committed).
   */
  discardLastStroke(): Stroke | null {
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top || top.type !== 'add') return null;
    this.undoStack.pop();
    const stroke = this.strokes.pop() ?? null;
    this.bumpMutation();
    return stroke;
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
    this.undoStack = quantizedStrokes.map(s => ({ type: 'add' as const, timestamp: s.timestamp }));
    this.redoStack = redoStack.map(stroke => ({ type: 'add' as const, stroke: quantizeStroke(stroke) }));
    this.currentStroke = null;
    this.undoReferenceCount = 0;
    this.tentativeClearState = null;
    // Make sure future startStroke()s issue timestamps strictly greater than
    // any restored stroke's, so identity-by-timestamp lookups stay unique.
    for (const s of quantizedStrokes) {
      if (s.timestamp > this.lastIssuedTimestamp) this.lastIssuedTimestamp = s.timestamp;
    }
    for (const e of this.redoStack) {
      if (e.type === 'add' && e.stroke.timestamp > this.lastIssuedTimestamp) {
        this.lastIssuedTimestamp = e.stroke.timestamp;
      }
    }
    this.bumpMutation();
  }

  getRedoStack(): readonly Stroke[] {
    const result: Stroke[] = [];
    for (const e of this.redoStack) {
      if (e.type === 'add') result.push(e.stroke);
    }
    return result;
  }

  /**
   * Destructive wipe: drops all strokes AND the entire undo/redo stack
   * (including reference history). Used by the gesture-session per-pose
   * advance where recovery to a previous pose is undesirable. For the
   * user-facing trash button and reference-change auto-clear, use
   * `tentativeClear()` instead — it preserves the strokes on the undo stack
   * so Undo can recover them.
   */
  clear(): void {
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.currentStroke = null;
    this.undoReferenceCount = 0;
    this.tentativeClearState = null;
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
