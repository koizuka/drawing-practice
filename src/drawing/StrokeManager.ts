import type { Point, ReferenceSnapshot, Stroke } from './types';
import { quantizePoint, quantizeStroke } from './quantize';
import {
  DEFAULT_LAYER_ID,
  MAX_LAYERS,
  MIN_LAYER_OPACITY,
  createDefaultLayerState,
  isStrokeInFrame,
  layerIdOf,
  maxLayerSeq,
  sanitizeLayerState,
  withLayerId,
  type Layer,
  type LayerState,
} from './layers';
import {
  DEFAULT_FRAME_ID,
  MAX_FRAMES,
  SHARED_FRAME_ID,
  FPS_OPTIONS,
  createDefaultFrameState,
  maxFrameSeq,
  resolveFrameId,
  sanitizeFrameState,
  sanitizeVideoSync,
  type VideoSync,
  withFrameId,
  type FrameState,
  type FrameView,
} from './frames';

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
type UndoEntry =
  | { type: 'add'; timestamp: number }
  | { type: 'delete'; stroke: Stroke; index: number }
  | { type: 'lasso-delete'; items: LassoDeleteItem[] }
  | { type: 'reference'; prev: ReferenceSnapshot }
  | { type: 'clear'; strokes: Stroke[] }
  | LayerDeleteEntry
  | FrameAddEntry
  | FrameDeleteEntry;

/**
 * A frame inserted (empty, or as a duplicate carrying copies of the source
 * frame's strokes). Undo removes the frame and those strokes; redo re-inserts
 * both. Same shape on both stacks.
 */
interface FrameAddEntry {
  type: 'frame-add';
  frameId: string;
  frameIndex: number;
  strokes: Stroke[];
  prevCurrentFrameId: string;
}

/**
 * One or more frames removed together with their per-frame strokes, as ONE
 * undo unit (shape like layer-delete). `frames` is ascending by original
 * index, so undo re-inserts them in that order and every one lands back at
 * its old position.
 */
interface FrameDeleteEntry {
  type: 'frame-delete';
  frames: { frameId: string; frameIndex: number }[];
  items: LassoDeleteItem[];
  prevCurrentFrameId: string;
}

/**
 * A layer removed together with its strokes. Undo re-inserts the layer at
 * `layerIndex` and splices the strokes back (ascending, like lasso-delete);
 * redo removes them again. Same shape on both stacks.
 */
interface LayerDeleteEntry {
  type: 'layer-delete';
  layer: Layer;
  layerIndex: number;
  items: LassoDeleteItem[];
  /** Active layer before the deletion, restored on undo. */
  prevActiveLayerId: string;
}

/** Fields of a layer the UI may change in place (non-undoable view/settings edits). */
export type LayerPatch = Partial<
  Pick<Layer, 'name' | 'visible' | 'opacity' | 'locked' | 'color' | 'shared'>
>;

/** Document-level state restored by `loadState` (all parts optional). */
export type DocState = Partial<LayerState> & Partial<FrameState>;

/** An entry on the redo stack stores enough data to replay the action. */
type RedoEntry =
  | { type: 'add'; stroke: Stroke }
  | { type: 'delete'; stroke: Stroke; index: number }
  | { type: 'lasso-delete'; items: LassoDeleteItem[] }
  | { type: 'reference'; next: ReferenceSnapshot }
  | { type: 'clear'; strokes: Stroke[] }
  | LayerDeleteEntry
  | FrameAddEntry
  | FrameDeleteEntry;

/** Result returned from undo()/redo() so callers can distinguish what changed. */
export type UndoResult =
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'strokes'; strokes: Stroke[] }
  | { kind: 'reference' }
  | { kind: 'layer' }
  | { kind: 'frame' }
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
  /** Layers bottom → top. Never empty. See src/drawing/layers.ts. */
  private layers: Layer[] = createDefaultLayerState().layers;
  private activeLayerId: string = DEFAULT_LAYER_ID;
  /**
   * Highest `layer-N` number ever issued or loaded this session. Monotonic so
   * a deleted layer's id (still restorable by undo/redo) is never reissued to
   * a new layer — two layers sharing an id would mix their settings and let a
   * redo of the old deletion take the new layer's strokes with it.
   */
  private layerSeq = 0;
  /** Animation frames (ids in playback order) — see src/drawing/frames.ts. */
  private frames: string[] = createDefaultFrameState().frames;
  private currentFrameId: string = createDefaultFrameState().currentFrameId;
  private fps: number = createDefaultFrameState().fps;
  private videoSync: VideoSync | undefined = undefined;
  /** Monotonic, for the same reason as `layerSeq`. */
  private frameSeq = 0;

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
    const base = withLayerId(
      { points: [quantizePoint(point)], timestamp: this.nextTimestamp() },
      this.activeLayerId,
    );
    // Shared (all-frames) layers record the SHARED marker instead of a frame.
    this.currentStroke = withFrameId(
      base,
      this.getActiveLayer().shared ? SHARED_FRAME_ID : this.currentFrameId,
    );
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
    // only by `endStroke`'s `redoStack = []` running before any observer; the
    // copies here make the invariant local and survive refactors.
    this.undoStack.push({ type: 'clear', strokes: this.strokes.slice() });
    this.tentativeClearState = { savedStrokes: this.strokes.slice() };
    this.strokes = [];
    this.currentStroke = null;
    this.redoStack = [];
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
      this.tentativeClearState.savedStrokes.map((s) => s.timestamp),
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
        const remainingItems = e.items.filter((it) => !clearedTimestamps.has(it.stroke.timestamp));
        if (remainingItems.length === 0) continue;
        survived.push({ type: 'lasso-delete', items: remainingItems });
        continue;
      }
      if (e.type === 'layer-delete' || e.type === 'frame-delete') {
        // Keep the entry even when no strokes remain: undo still restores the layer / frame.
        survived.push({
          ...e,
          items: e.items.filter((it) => !clearedTimestamps.has(it.stroke.timestamp)),
        });
        continue;
      }
      if (e.type === 'frame-add') {
        survived.push({
          ...e,
          strokes: e.strokes.filter((st) => !clearedTimestamps.has(st.timestamp)),
        });
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
    const idx = this.undoStack.findIndex((e) => e.type === 'reference');
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
    if (entry.type === 'layer-delete') {
      const layerIndex = Math.min(entry.layerIndex, this.layers.length);
      this.layers.splice(layerIndex, 0, entry.layer);
      for (const item of entry.items) {
        // Clamp: a committed tentative clear may have shrunk the array since.
        this.strokes.splice(Math.min(item.index, this.strokes.length), 0, item.stroke);
      }
      if (this.layers.some((l) => l.id === entry.prevActiveLayerId)) {
        this.activeLayerId = entry.prevActiveLayerId;
      }
      this.redoStack.push(entry);
      this.bumpMutation();
      return { kind: 'layer' };
    }
    if (entry.type === 'frame-add') {
      const ts = new Set(entry.strokes.map((st) => st.timestamp));
      this.strokes = this.strokes.filter((st) => !ts.has(st.timestamp));
      this.removeFrameId(entry.frameId);
      if (this.frames.includes(entry.prevCurrentFrameId)) {
        this.currentFrameId = entry.prevCurrentFrameId;
      }
      this.redoStack.push(entry);
      this.bumpMutation();
      return { kind: 'frame' };
    }
    if (entry.type === 'frame-delete') {
      for (const f of entry.frames) {
        this.frames.splice(Math.min(f.frameIndex, this.frames.length), 0, f.frameId);
      }
      for (const item of entry.items) {
        this.strokes.splice(Math.min(item.index, this.strokes.length), 0, item.stroke);
      }
      this.currentFrameId = this.frames.includes(entry.prevCurrentFrameId)
        ? entry.prevCurrentFrameId
        : entry.frames[0].frameId;
      this.redoStack.push(entry);
      this.bumpMutation();
      return { kind: 'frame' };
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
    if (entry.type === 'layer-delete') {
      this.removeLayerAndStrokes(entry.layer.id);
      this.undoStack.push(entry);
      this.bumpMutation();
      return { kind: 'layer' };
    }
    if (entry.type === 'frame-add') {
      this.frames.splice(Math.min(entry.frameIndex, this.frames.length), 0, entry.frameId);
      this.strokes.push(...entry.strokes);
      this.currentFrameId = entry.frameId;
      this.undoStack.push(entry);
      this.bumpMutation();
      return { kind: 'frame' };
    }
    if (entry.type === 'frame-delete') {
      this.removeFramesAndStrokes(entry.frames.map((f) => f.frameId));
      this.undoStack.push(entry);
      this.bumpMutation();
      return { kind: 'frame' };
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
    this.strokes = this.strokes.filter((s) => !timestamps.has(s.timestamp));
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
        const remainingItems = e.items.filter((it) => !timestamps.has(it.stroke.timestamp));
        if (remainingItems.length === 0) continue;
        survived.push({ type: 'lasso-delete', items: remainingItems });
        continue;
      }
      if (e.type === 'layer-delete' || e.type === 'frame-delete') {
        survived.push({
          ...e,
          items: e.items.filter((it) => !timestamps.has(it.stroke.timestamp)),
        });
        continue;
      }
      if (e.type === 'frame-add') {
        survived.push({ ...e, strokes: e.strokes.filter((st) => !timestamps.has(st.timestamp)) });
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
    this.undoReferenceCount = this.undoStack.filter((e) => e.type === 'reference').length;
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
      .filter((i) => i >= 0 && i < this.strokes.length)
      .sort((a, b) => a - b);
    if (valid.length === 0) return null;

    // Capture (stroke, original index) pairs in ascending-index order. Then
    // splice in descending order so earlier indices remain valid.
    const items: LassoDeleteItem[] = valid.map((index) => ({
      stroke: this.strokes[index],
      index,
    }));
    for (let i = valid.length - 1; i >= 0; i--) {
      this.strokes.splice(valid[i], 1);
    }
    this.undoStack.push({ type: 'lasso-delete', items });
    this.redoStack = [];
    this.bumpMutation();
    return items.map((it) => it.stroke);
  }

  /**
   * Find the nearest stroke to a point within the given threshold distance.
   * Only strokes the erase tools may touch (`isStrokeEditable`) are candidates.
   */
  findNearestStroke(point: Point, threshold: number): number | null {
    let bestIndex: number | null = null;
    let bestDist = threshold;

    for (let i = 0; i < this.strokes.length; i++) {
      const stroke = this.strokes[i];
      if (!this.isStrokeEditable(stroke)) continue;
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

  /**
   * Replace the whole drawing. `layerState` absent ⇒ the default single layer
   * (pre-layer drafts / gallery records). Strokes pointing at a layer that is
   * not in the list are reassigned to the bottom layer so nothing becomes
   * unreachable.
   */
  loadState(strokes: Stroke[], redoStack: Stroke[], layerState?: DocState): void {
    const ls = sanitizeLayerState(layerState?.layers, layerState?.activeLayerId);
    // Frames: absent ⇒ a single default frame (pre-animation data). Strokes on
    // an unknown frame are left as-is — resolveFrameId maps them to the first
    // frame wherever frames are evaluated.
    const fs = sanitizeFrameState(layerState ?? {});
    this.frames = fs.frames;
    this.currentFrameId = fs.currentFrameId;
    this.fps = fs.fps;
    this.videoSync = fs.videoSync;
    this.frameSeq = Math.max(this.frameSeq, maxFrameSeq(fs.frames));
    this.layers = ls.layers;
    this.activeLayerId = ls.activeLayerId;
    this.layerSeq = Math.max(this.layerSeq, maxLayerSeq(ls.layers));
    const known = new Set(ls.layers.map((l) => l.id));
    const fallback = ls.layers[0].id;
    const normalize = (s: Stroke): Stroke => {
      const q = quantizeStroke(s);
      return known.has(layerIdOf(q)) ? q : withLayerId(q, fallback);
    };
    // Quantize on entry so legacy session drafts and gallery loads land in the
    // same already-quantized state as freshly-drawn strokes.
    const quantizedStrokes = strokes.map(normalize);
    this.strokes = quantizedStrokes;
    this.undoStack = quantizedStrokes.map((s) => ({
      type: 'add' as const,
      timestamp: s.timestamp,
    }));
    this.redoStack = redoStack.map((stroke) => ({
      type: 'add' as const,
      stroke: normalize(stroke),
    }));
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

  // ── Layers ───────────────────────────────────────────────────────────────
  // Settings edits (add / rename / visibility / opacity / lock / color /
  // reorder / active) are NOT undoable — like masksHidden they are view-ish
  // state, and keeping them off the stack means stroke undo never has to
  // reason about a layer that moved. Only `deleteLayer` (which destroys
  // strokes) is recorded. Every layer edit except `setActiveLayer` bumps the
  // gallery-dirty counter because it changes what a save would write.

  getLayers(): readonly Layer[] {
    return this.layers;
  }

  getActiveLayerId(): string {
    return this.activeLayerId;
  }

  getActiveLayer(): Layer {
    return this.layers.find((l) => l.id === this.activeLayerId) ?? this.layers[0];
  }

  /** Snapshot for persistence. */
  getLayerState(): LayerState {
    return { layers: this.layers.map((l) => ({ ...l })), activeLayerId: this.activeLayerId };
  }

  setActiveLayer(id: string): boolean {
    if (id === this.activeLayerId || !this.layers.some((l) => l.id === id)) return false;
    this.activeLayerId = id;
    return true;
  }

  /** Pen input is accepted only on a visible, unlocked active layer. */
  canDrawOnActiveLayer(): boolean {
    const l = this.getActiveLayer();
    return l.visible && !l.locked;
  }

  /**
   * Erase tools (tap / lasso / clear-layer) only touch strokes on the drawable
   * active layer that are part of the current frame (shared layers: any).
   */
  isStrokeEditable(stroke: Stroke): boolean {
    return (
      layerIdOf(stroke) === this.activeLayerId &&
      this.canDrawOnActiveLayer() &&
      isStrokeInFrame(stroke, this.getActiveLayer(), this.getFrameView())
    );
  }

  getLayerStrokeCount(id: string): number {
    let n = 0;
    for (const s of this.strokes) if (layerIdOf(s) === id) n++;
    return n;
  }

  /**
   * Add a layer directly above the active one and make it active. Returns
   * null at MAX_LAYERS.
   */
  addLayer(init: LayerPatch = {}): Layer | null {
    if (this.layers.length >= MAX_LAYERS) return null;
    this.layerSeq = Math.max(this.layerSeq, maxLayerSeq(this.layers)) + 1;
    const layer: Layer = {
      id: `layer-${this.layerSeq}`,
      name: '',
      visible: true,
      opacity: 1,
      locked: false,
      color: 'ink',
      ...init,
    };
    const at = this.layers.findIndex((l) => l.id === this.activeLayerId);
    this.layers.splice(at + 1, 0, layer);
    this.activeLayerId = layer.id;
    this.bumpMutation();
    return layer;
  }

  updateLayer(id: string, patch: LayerPatch): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return false;
    const prev = this.layers[i];
    const next: Layer = { ...prev, ...patch };
    next.opacity = Math.min(1, Math.max(MIN_LAYER_OPACITY, next.opacity));
    if (!next.shared) delete next.shared;
    this.layers[i] = next;
    if (prev.shared && !next.shared) {
      // Turning sharing off: the strokes drawn while shared move onto the
      // current frame (otherwise they'd fall back to the first frame and
      // vanish from the frame the user is looking at). Mutated IN PLACE so
      // undo entries holding these same objects stay consistent.
      for (const s of this.strokes) {
        if (layerIdOf(s) === id && s.frameId === SHARED_FRAME_ID) {
          if (this.currentFrameId === DEFAULT_FRAME_ID) delete s.frameId;
          else s.frameId = this.currentFrameId;
        }
      }
    }
    this.bumpMutation();
    return true;
  }

  /** Move a layer up (+1, towards the top) or down (-1) in z-order. */
  moveLayer(id: string, delta: 1 | -1): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
    this.bumpMutation();
    return true;
  }

  /**
   * Delete a layer and all its strokes as ONE undo entry. The last remaining
   * layer cannot be deleted (use the trash button / clearLayer instead).
   */
  deleteLayer(id: string): boolean {
    if (this.layers.length <= 1) return false;
    const layerIndex = this.layers.findIndex((l) => l.id === id);
    if (layerIndex < 0) return false;
    const entry: LayerDeleteEntry = {
      type: 'layer-delete',
      layer: this.layers[layerIndex],
      layerIndex,
      items: [],
      prevActiveLayerId: this.activeLayerId,
    };
    this.strokes.forEach((stroke, index) => {
      if (layerIdOf(stroke) === id) entry.items.push({ stroke, index });
    });
    this.removeLayerAndStrokes(id);
    this.undoStack.push(entry);
    this.redoStack = [];
    this.bumpMutation();
    return true;
  }

  /**
   * Erase every stroke on the active layer as one (undoable) lasso-delete
   * entry. Same protection as the eraser: only the active, visible, unlocked
   * layer — a lock must also guard against bulk erase.
   */
  clearLayer(id: string): Stroke[] | null {
    if (id !== this.activeLayerId || !this.canDrawOnActiveLayer()) return null;
    // With animation this is "the active layer's lines on the current frame".
    const indices: number[] = [];
    this.strokes.forEach((s, i) => {
      if (this.isStrokeEditable(s)) indices.push(i);
    });
    return this.lassoDelete(indices);
  }

  /** Shared by deleteLayer / redo: drop the layer + its strokes, fix up the active id. */
  private removeLayerAndStrokes(id: string): void {
    const layerIndex = this.layers.findIndex((l) => l.id === id);
    if (layerIndex < 0) return;
    this.strokes = this.strokes.filter((s) => layerIdOf(s) !== id);
    this.layers.splice(layerIndex, 1);
    if (this.activeLayerId === id) {
      // Prefer the layer that was below, else the new bottom.
      this.activeLayerId = this.layers[Math.max(0, layerIndex - 1)].id;
    }
  }

  // ── Frames ───────────────────────────────────────────────────────────────
  // Frame add / duplicate / delete are undoable (they change the animation's
  // content; duplicate creates strokes). Selecting a frame is view state (no
  // dirty bump); reorder and fps are non-undoable settings that bump dirty.

  getFrames(): readonly string[] {
    return this.frames;
  }

  getCurrentFrameId(): string {
    return this.currentFrameId;
  }

  getCurrentFrameIndex(): number {
    return Math.max(0, this.frames.indexOf(this.currentFrameId));
  }

  getFrameView(frameId: string = this.currentFrameId): FrameView {
    return { frames: this.frames, frameId };
  }

  getFps(): number {
    return this.fps;
  }

  /** Layers + frames snapshot for persistence. */
  getDocState(): LayerState & FrameState {
    return { ...this.getLayerState(), ...this.getFrameState() };
  }

  /** Snapshot for persistence. */
  getFrameState(): FrameState {
    return {
      frames: this.frames.slice(),
      currentFrameId: this.currentFrameId,
      fps: this.fps,
      ...(this.videoSync ? { videoSync: { ...this.videoSync } } : {}),
    };
  }

  getVideoSync(): VideoSync | undefined {
    // A copy: edits must go through setVideoSync (validation + dirty bump).
    return this.videoSync ? { ...this.videoSync } : undefined;
  }

  /**
   * Set / clear the rotoscope sync. A setting like fps: not undoable, but it
   * bumps gallery-dirty (it is saved with the drawing).
   */
  setVideoSync(sync: VideoSync | null): boolean {
    const next = sync ? sanitizeVideoSync(sync) : undefined;
    if (sync && !next) return false;
    const cur = this.videoSync;
    if (
      cur === next ||
      (cur &&
        next &&
        cur.videoId === next.videoId &&
        cur.offset === next.offset &&
        cur.step === next.step)
    ) {
      return false;
    }
    this.videoSync = next;
    this.bumpMutation();
    return true;
  }

  setFps(fps: number): boolean {
    if (fps === this.fps || !(FPS_OPTIONS as readonly number[]).includes(fps)) return false;
    this.fps = fps;
    this.bumpMutation();
    return true;
  }

  setCurrentFrame(id: string): boolean {
    if (id === this.currentFrameId || !this.frames.includes(id)) return false;
    this.currentFrameId = id;
    // Not undoable, but it changes what a gallery save shows (thumbnail /
    // export use the current frame), so it counts as a saveable change.
    this.bumpMutation();
    return true;
  }

  /**
   * Insert a frame and select it — right after the current one by default, or
   * at the end with `atEnd` (the filmstrip's trailing "+" cell). With
   * `duplicate`, the current frame's per-frame strokes (non-shared layers) are
   * copied onto it. Returns the new frame id, or null at MAX_FRAMES.
   */
  addFrame(opts: { duplicate?: boolean; atEnd?: boolean } = {}): string | null {
    if (this.frames.length >= MAX_FRAMES) return null;
    this.frameSeq = Math.max(this.frameSeq, maxFrameSeq(this.frames)) + 1;
    const frameId = `frame-${this.frameSeq}`;
    const frameIndex = opts.atEnd ? this.frames.length : this.getCurrentFrameIndex() + 1;
    const copies: Stroke[] = [];
    if (opts.duplicate) {
      const byId = new Map(this.layers.map((l) => [l.id, l]));
      for (const st of this.strokes) {
        const layer = byId.get(layerIdOf(st)) ?? this.layers[0];
        if (layer.shared) continue;
        if (resolveFrameId(st, this.frames) !== this.currentFrameId) continue;
        copies.push(
          withFrameId(
            { ...st, points: st.points.map((p) => ({ ...p })), timestamp: this.nextTimestamp() },
            frameId,
          ),
        );
      }
    }
    const entry: FrameAddEntry = {
      type: 'frame-add',
      frameId,
      frameIndex,
      strokes: copies,
      prevCurrentFrameId: this.currentFrameId,
    };
    this.frames.splice(frameIndex, 0, frameId);
    this.strokes.push(...copies);
    this.currentFrameId = frameId;
    this.undoStack.push(entry);
    this.redoStack = [];
    this.bumpMutation();
    return frameId;
  }

  /** Delete a frame and its per-frame strokes as ONE undo entry (never the last frame). */
  deleteFrame(id: string): boolean {
    return this.deleteFrames([id]);
  }

  /**
   * Delete several frames (and their per-frame strokes) as ONE undo entry.
   * Unknown / duplicate ids are ignored; refuses when nothing would be
   * deleted or when it would leave no frame at all.
   */
  deleteFrames(ids: readonly string[]): boolean {
    const wanted = new Set(ids);
    const frames = this.frames
      .map((frameId, frameIndex) => ({ frameId, frameIndex }))
      .filter((f) => wanted.has(f.frameId));
    if (frames.length === 0 || frames.length >= this.frames.length) return false;
    const doomed = new Set(frames.map((f) => f.frameId));
    const entry: FrameDeleteEntry = {
      type: 'frame-delete',
      frames,
      items: [],
      prevCurrentFrameId: this.currentFrameId,
    };
    this.strokes.forEach((stroke, index) => {
      if (this.isOnAnyFrame(stroke, doomed)) entry.items.push({ stroke, index });
    });
    this.removeFramesAndStrokes([...doomed]);
    this.undoStack.push(entry);
    this.redoStack = [];
    this.bumpMutation();
    return true;
  }

  /** Move a frame earlier (-1) or later (+1) in playback order. */
  moveFrame(id: string, delta: 1 | -1): boolean {
    const i = this.frames.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.frames.length) return false;
    [this.frames[i], this.frames[j]] = [this.frames[j], this.frames[i]];
    this.bumpMutation();
    return true;
  }

  /** Per-frame stroke count for a frame (shared layers excluded). */
  getFrameStrokeCount(id: string): number {
    let n = 0;
    for (const s of this.strokes) if (this.isOnFrame(s, id)) n++;
    return n;
  }

  /** True when `stroke` is a per-frame stroke living on frame `id`. */
  private isOnFrame(stroke: Stroke, id: string): boolean {
    return this.isOnAnyFrame(stroke, new Set([id]));
  }

  /**
   * True when `stroke` is a per-frame stroke living on one of `ids`, judged
   * against the CURRENT frame list (so a stroke on a vanished frame that
   * resolves to the first frame goes with the first frame).
   */
  private isOnAnyFrame(stroke: Stroke, ids: ReadonlySet<string>): boolean {
    const layer = this.layers.find((l) => l.id === layerIdOf(stroke)) ?? this.layers[0];
    return !layer.shared && ids.has(resolveFrameId(stroke, this.frames));
  }

  /** Remove frames + their strokes. Strokes are picked BEFORE any id is dropped. */
  private removeFramesAndStrokes(ids: readonly string[]): void {
    const set = new Set(ids);
    const doomed = new Set(this.strokes.filter((st) => this.isOnAnyFrame(st, set)));
    this.strokes = this.strokes.filter((st) => !doomed.has(st));
    // Current frame deleted ⇒ the nearest surviving frame before it (else the first).
    if (set.has(this.currentFrameId)) {
      const i = this.frames.indexOf(this.currentFrameId);
      const before = this.frames
        .slice(0, i)
        .reverse()
        .find((f) => !set.has(f));
      this.currentFrameId = before ?? this.frames.find((f) => !set.has(f)) ?? this.frames[0];
    }
    this.frames = this.frames.filter((f) => !set.has(f));
  }

  /** Drop a frame id, moving the selection to the previous frame when needed. */
  private removeFrameId(id: string): void {
    const i = this.frames.indexOf(id);
    if (i < 0) return;
    this.frames.splice(i, 1);
    if (this.currentFrameId === id) {
      this.currentFrameId = this.frames[Math.max(0, i - 1)];
    }
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
