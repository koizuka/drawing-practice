import type { Point, ReferenceSnapshot, Stroke } from './types';

/** Maximum number of reference-change entries kept in history to bound memory. */
const MAX_REFERENCE_HISTORY = 20;

/** An entry on the undo stack records one reversible action. */
type UndoEntry
  = | { type: 'add' }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'reference'; prev: ReferenceSnapshot };

/** An entry on the redo stack stores enough data to replay the action. */
type RedoEntry
  = | { type: 'add'; stroke: Stroke }
    | { type: 'delete'; stroke: Stroke; index: number }
    | { type: 'reference'; next: ReferenceSnapshot };

/** Result returned from undo()/redo() so callers can distinguish what changed. */
export type UndoResult
  = | { kind: 'stroke'; stroke: Stroke }
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

  startStroke(point: Point): void {
    this.currentStroke = {
      points: [point],
      timestamp: Date.now(),
    };
  }

  appendStroke(point: Point): void {
    if (!this.currentStroke) return;
    this.currentStroke.points.push(point);
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
      return { kind: 'stroke', stroke };
    }
    if (entry.type === 'delete') {
      this.strokes.splice(entry.index, 0, entry.stroke);
      this.redoStack.push({ type: 'delete', stroke: entry.stroke, index: entry.index });
      return { kind: 'stroke', stroke: entry.stroke };
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
      return { kind: 'stroke', stroke: entry.stroke };
    }
    if (entry.type === 'delete') {
      const [removed] = this.strokes.splice(entry.index, 1);
      this.undoStack.push({ type: 'delete', stroke: removed, index: entry.index });
      return { kind: 'stroke', stroke: removed };
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
    return removed;
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
    this.strokes = [...strokes];
    this.undoStack = strokes.map(() => ({ type: 'add' as const }));
    this.redoStack = redoStack.map(stroke => ({ type: 'add' as const, stroke }));
    this.currentStroke = null;
    this.undoReferenceCount = 0;
  }

  getRedoStack(): readonly Stroke[] {
    return this.redoStack
      .filter((e): e is RedoEntry & { type: 'add' } => e.type === 'add')
      .map(e => e.stroke);
  }

  clear(): void {
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.currentStroke = null;
    this.undoReferenceCount = 0;
  }
}
