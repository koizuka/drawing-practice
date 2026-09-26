import type {
  GuideLine,
  GridSettings,
  GridMode,
  GuideState,
  MaskRect,
  PerspectiveSettings,
} from './types';
import {
  DEFAULT_GUIDE_STATE,
  DEFAULT_PERSPECTIVE,
  MAX_PERSPECTIVE_MEMORIES,
  migrateGridSettings,
  perspectiveSettingsEqual,
  sanitizeMasks,
  sanitizePerspectiveSettings,
  smallestFreeMemorySeq,
} from './types';

let nextId = 1;

export class GuideManager {
  private state: GuideState;

  constructor(initial?: GuideState) {
    this.state = initial
      ? {
          ...initial,
          lines: [...initial.lines],
          masks: [...(initial.masks ?? [])],
          masksHidden: initial.masksHidden ?? true,
        }
      : { ...DEFAULT_GUIDE_STATE, lines: [], masks: [], masksHidden: true };
  }

  getState(): GuideState {
    return this.state;
  }

  getGrid(): GridSettings {
    return this.state.grid;
  }

  setGridMode(mode: GridMode): void {
    // Keep perspective settings (and captured memories) across mode switches
    // so re-entering the perspective mode restores the previous composition.
    const perspective =
      mode === 'perspective'
        ? (this.state.grid.perspective ?? DEFAULT_PERSPECTIVE)
        : this.state.grid.perspective;
    const memories = this.state.grid.perspectiveMemories;
    this.state.grid = {
      mode,
      ...(perspective ? { perspective } : {}),
      ...(memories?.length ? { perspectiveMemories: memories } : {}),
    };
  }

  setPerspective(patch: Partial<PerspectiveSettings>): void {
    const current = this.state.grid.perspective ?? DEFAULT_PERSPECTIVE;
    this.state.grid = {
      ...this.state.grid,
      perspective: sanitizePerspectiveSettings({ ...current, ...patch }),
    };
  }

  /**
   * Snapshot the current perspective settings into the memory list so the user
   * can recall this angle later. Appends (oldest first, oldest evicted at the
   * cap); a snapshot identical to an existing memory is skipped so repeated
   * strokes at the same angle don't flood the list. Returns whether the list
   * changed, so callers can skip a state sync on the common same-angle stroke.
   */
  recordPerspectiveMemory(): boolean {
    const current = this.state.grid.perspective ?? DEFAULT_PERSPECTIVE;
    const memories = this.state.grid.perspectiveMemories ?? [];
    if (memories.some((m) => perspectiveSettingsEqual(m.settings, current))) return false;
    // Evict the oldest entry when full, then label the new one with the
    // smallest free number — surviving entries keep their labels, and reuse
    // keeps every label single-digit (see PerspectiveMemory.seq).
    const kept = memories.slice(-(MAX_PERSPECTIVE_MEMORIES - 1));
    const seq = smallestFreeMemorySeq(new Set(kept.map((m) => m.seq)));
    this.state.grid = {
      ...this.state.grid,
      perspectiveMemories: [...kept, { seq, settings: { ...current } }],
    };
    return true;
  }

  /** Delete one memory by its label number; the freed number goes back into the reuse pool. */
  removePerspectiveMemory(seq: number): boolean {
    const memories = this.state.grid.perspectiveMemories ?? [];
    const filtered = memories.filter((m) => m.seq !== seq);
    if (filtered.length === memories.length) return false;
    this.state.grid = { ...this.state.grid, perspectiveMemories: filtered };
    return true;
  }

  getLines(): readonly GuideLine[] {
    return this.state.lines;
  }

  addLine(x1: number, y1: number, x2: number, y2: number): GuideLine {
    const line: GuideLine = { id: `guide-${nextId++}`, x1, y1, x2, y2 };
    this.state.lines.push(line);
    return line;
  }

  removeLine(id: string): boolean {
    const index = this.state.lines.findIndex((l) => l.id === id);
    if (index === -1) return false;
    this.state.lines.splice(index, 1);
    return true;
  }

  clearLines(): void {
    this.state.lines = [];
  }

  getMasks(): readonly MaskRect[] {
    return this.state.masks ?? [];
  }

  /**
   * Add a mask spanning the two drag corners (any order). The caller is
   * responsible for rejecting degenerate drags (screen-space threshold); the
   * manager only normalizes to { x, y, w, h } with w, h >= 0.
   */
  addMask(x1: number, y1: number, x2: number, y2: number): MaskRect {
    const mask: MaskRect = {
      id: `mask-${nextId++}`,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
    this.state.masks = [...this.getMasks(), mask];
    return mask;
  }

  removeMask(id: string): boolean {
    const masks = this.getMasks();
    const filtered = masks.filter((m) => m.id !== id);
    if (filtered.length === masks.length) return false;
    this.state.masks = filtered;
    return true;
  }

  clearMasks(): void {
    this.state.masks = [];
  }

  getMasksHidden(): boolean {
    return this.state.masksHidden ?? true;
  }

  setMasksHidden(hidden: boolean): void {
    this.state.masksHidden = hidden;
  }

  /** Topmost (last-added) mask containing the point, or null. */
  findMaskAt(x: number, y: number): MaskRect | null {
    return findMaskAt(this.getMasks(), x, y);
  }

  importState(state: GuideState): void {
    this.state = {
      grid: migrateGridSettings(state.grid),
      lines: [...state.lines],
      masks: sanitizeMasks(state.masks),
      // Anything but an explicit `false` keeps the answer hidden.
      masksHidden: state.masksHidden !== false,
    };
    // Update nextId to avoid collisions with imported line / mask ids (both
    // share the same counter).
    for (const item of [...this.state.lines, ...(this.state.masks ?? [])]) {
      const match = item.id.match(/^(?:guide|mask)-(\d+)$/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id >= nextId) nextId = id + 1;
      }
    }
  }

  findNearestLine(x: number, y: number, threshold: number): GuideLine | null {
    let best: GuideLine | null = null;
    let bestDist = threshold;

    for (const line of this.state.lines) {
      const dist = pointToSegmentDistance(x, y, line.x1, line.y1, line.x2, line.y2);
      if (dist < bestDist) {
        bestDist = dist;
        best = line;
      }
    }

    return best;
  }
}

/** Topmost (last in array = last-added) mask containing (x, y), edges inclusive. */
export function findMaskAt(masks: readonly MaskRect[], x: number, y: number): MaskRect | null {
  for (let i = masks.length - 1; i >= 0; i--) {
    const m = masks[i];
    if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return m;
  }
  return null;
}

export type MaskGestureResult = { kind: 'add' } | { kind: 'remove'; id: string } | null;

/**
 * Classify a finished single-pointer gesture in 'mask' mode (world coords).
 * - Both extents exceed `minSize` (screen threshold / scale) → add a mask.
 * - Movement within `minSize` (a tap) on an existing mask at the DOWN point →
 *   remove that mask.
 * - Anything else (tap on empty space, thin sliver drag) → nothing.
 */
export function resolveMaskGesture(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minSize: number,
  masks: readonly MaskRect[],
): MaskGestureResult {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx > minSize && dy > minSize) return { kind: 'add' };
  if (Math.sqrt(dx * dx + dy * dy) <= minSize) {
    const hit = findMaskAt(masks, start.x, start.y);
    if (hit) return { kind: 'remove', id: hit.id };
  }
  return null;
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const ex = px - x1;
    const ey = py - y1;
    return Math.sqrt(ex * ex + ey * ey);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const ex = px - closestX;
  const ey = py - closestY;
  return Math.sqrt(ex * ex + ey * ey);
}
