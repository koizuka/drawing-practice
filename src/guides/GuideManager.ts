import type { GuideLine, GridSettings, GridMode, GuideState, PerspectiveSettings } from './types';
import {
  DEFAULT_GUIDE_STATE,
  DEFAULT_PERSPECTIVE,
  MAX_PERSPECTIVE_MEMORIES,
  migrateGridSettings,
  perspectiveSettingsEqual,
  sanitizePerspectiveSettings,
  smallestFreeMemorySeq,
} from './types';

let nextId = 1;

export class GuideManager {
  private state: GuideState;

  constructor(initial?: GuideState) {
    this.state = initial ? { ...initial, lines: [...initial.lines] } : { ...DEFAULT_GUIDE_STATE, lines: [] };
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
    const perspective = mode === 'perspective'
      ? this.state.grid.perspective ?? DEFAULT_PERSPECTIVE
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
    if (memories.some(m => perspectiveSettingsEqual(m.settings, current))) return false;
    // Evict the oldest entry when full, then label the new one with the
    // smallest free number — surviving entries keep their labels, and reuse
    // keeps every label single-digit (see PerspectiveMemory.seq).
    const kept = memories.slice(-(MAX_PERSPECTIVE_MEMORIES - 1));
    const seq = smallestFreeMemorySeq(new Set(kept.map(m => m.seq)));
    this.state.grid = {
      ...this.state.grid,
      perspectiveMemories: [...kept, { seq, settings: { ...current } }],
    };
    return true;
  }

  /** Delete one memory by its label number; the freed number goes back into the reuse pool. */
  removePerspectiveMemory(seq: number): boolean {
    const memories = this.state.grid.perspectiveMemories ?? [];
    const filtered = memories.filter(m => m.seq !== seq);
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
    const index = this.state.lines.findIndex(l => l.id === id);
    if (index === -1) return false;
    this.state.lines.splice(index, 1);
    return true;
  }

  clearLines(): void {
    this.state.lines = [];
  }

  importState(state: GuideState): void {
    this.state = { grid: migrateGridSettings(state.grid), lines: [...state.lines] };
    // Update nextId to avoid collisions with imported line ids
    for (const line of state.lines) {
      const match = line.id.match(/^guide-(\d+)$/);
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

export function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
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
