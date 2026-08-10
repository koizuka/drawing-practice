export interface GuideLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type GridMode = 'none' | 'normal' | 'large' | 'perspective';

export interface PerspectiveSettings {
  /** Horizontal rotation in degrees, [-90, 90]. 0 = facing the back wall. */
  yaw: number;
  /** Vertical rotation in degrees, [-90, 90]. 0 = level view. */
  pitch: number;
  /** Perspective strength 0..1. 0 ≈ parallel projection, 1 = wide-angle. */
  strength: number;
  /** World coordinates of the box anchor point (projection is translated here). */
  centerX: number;
  centerY: number;
}

export const DEFAULT_PERSPECTIVE: PerspectiveSettings = {
  yaw: 0,
  pitch: 0,
  strength: 0.5,
  centerX: 0,
  centerY: 0,
};

/**
 * Cap for perspective-settings snapshots captured while sketching. 9 keeps
 * every label single-digit and makes the recall buttons + delete toggle fill
 * a stable 5×2 grid inside the floating controller.
 */
export const MAX_PERSPECTIVE_MEMORIES = 9;

export interface PerspectiveMemory {
  /**
   * Label number (1..MAX_PERSPECTIVE_MEMORIES) shown on the recall button.
   * Never renumbered while the entry lives — deleting or evicting other
   * entries must not shift the number↔angle mapping the user has memorized.
   * Labels freed by deletion/eviction ARE reused for new entries (smallest
   * free number first), which is what keeps them single-digit forever.
   */
  seq: number;
  settings: PerspectiveSettings;
}

export interface GridSettings {
  mode: GridMode;
  /** Only meaningful when mode === 'perspective', but kept while switching modes. */
  perspective?: PerspectiveSettings;
  /**
   * Snapshots of perspective settings captured when a stroke was drawn, oldest
   * first, so the user can flip back to an angle they already sketched at.
   * Append-only with oldest-evicted at the cap; surviving entries keep their
   * `seq` labels.
   */
  perspectiveMemories?: PerspectiveMemory[];
}

export interface GuideState {
  grid: GridSettings;
  lines: GuideLine[];
}

export const DEFAULT_GUIDE_STATE: GuideState = {
  grid: { mode: 'none' },
  lines: [],
};

const GRID_SPACINGS: Record<GridMode, number> = {
  none: 0,
  normal: 100,
  large: 200,
  perspective: 0,
};

export function getGridSpacing(mode: GridMode): number {
  return GRID_SPACINGS[mode];
}

export const GRID_MODES: readonly GridMode[] = ['none', 'normal', 'large', 'perspective'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp each field to its valid range, falling back to defaults for non-finite values. */
export function sanitizePerspectiveSettings(p: unknown): PerspectiveSettings {
  const src = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof PerspectiveSettings, unknown>>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    yaw: clamp(num(src.yaw, DEFAULT_PERSPECTIVE.yaw), -90, 90),
    pitch: clamp(num(src.pitch, DEFAULT_PERSPECTIVE.pitch), -90, 90),
    strength: clamp(num(src.strength, DEFAULT_PERSPECTIVE.strength), 0, 1),
    centerX: num(src.centerX, DEFAULT_PERSPECTIVE.centerX),
    centerY: num(src.centerY, DEFAULT_PERSPECTIVE.centerY),
  };
}

const MEMORY_EPSILON = 1e-6;

/** Field-wise comparison with a float tolerance, for memory dedupe and recall-button highlighting. */
export function perspectiveSettingsEqual(a: PerspectiveSettings, b: PerspectiveSettings): boolean {
  return Math.abs(a.yaw - b.yaw) < MEMORY_EPSILON
    && Math.abs(a.pitch - b.pitch) < MEMORY_EPSILON
    && Math.abs(a.strength - b.strength) < MEMORY_EPSILON
    && Math.abs(a.centerX - b.centerX) < MEMORY_EPSILON
    && Math.abs(a.centerY - b.centerY) < MEMORY_EPSILON;
}

/** Smallest label in 1..MAX_PERSPECTIVE_MEMORIES not yet taken. */
export function smallestFreeMemorySeq(used: ReadonlySet<number>): number {
  let seq = 1;
  while (used.has(seq)) seq++;
  return seq;
}

/**
 * Sanitize a persisted memory list; undefined when there is nothing valid to
 * keep. Out-of-range or colliding labels get the smallest free one; legacy
 * entries (bare PerspectiveSettings, from drafts saved before `seq` labels
 * existed) have no label at all and are handled by the same fallback.
 */
export function sanitizePerspectiveMemories(memories: unknown): PerspectiveMemory[] | undefined {
  if (!Array.isArray(memories) || memories.length === 0) return undefined;
  const used = new Set<number>();
  return memories.slice(0, MAX_PERSPECTIVE_MEMORIES).map((m) => {
    const obj = (m && typeof m === 'object' ? m : {}) as { seq?: unknown; settings?: unknown };
    const valid = typeof obj.seq === 'number' && Number.isInteger(obj.seq)
      && obj.seq >= 1 && obj.seq <= MAX_PERSPECTIVE_MEMORIES && !used.has(obj.seq);
    const seq = valid ? obj.seq as number : smallestFreeMemorySeq(used);
    used.add(seq);
    // Legacy entries are the settings object itself; current ones nest it.
    return { seq, settings: sanitizePerspectiveSettings(obj.settings === undefined ? m : obj.settings) };
  });
}

/** Legacy grid settings stored before the GridMode migration */
interface LegacyGridSettings {
  enabled: boolean;
  spacing: number;
}

function isGridSettings(grid: object): grid is GridSettings {
  return 'mode' in grid
    && GRID_MODES.includes((grid as GridSettings).mode);
}

function isLegacyGridSettings(grid: object): grid is LegacyGridSettings {
  return 'enabled' in grid && typeof (grid as LegacyGridSettings).enabled === 'boolean';
}

/** Migrate legacy { enabled, spacing } format to { mode }, sanitizing perspective settings */
export function migrateGridSettings(grid: unknown): GridSettings {
  if (grid && typeof grid === 'object') {
    if (isGridSettings(grid)) {
      const memories = sanitizePerspectiveMemories(grid.perspectiveMemories);
      if (grid.perspective !== undefined || grid.mode === 'perspective') {
        return {
          mode: grid.mode,
          perspective: sanitizePerspectiveSettings(grid.perspective),
          ...(memories ? { perspectiveMemories: memories } : {}),
        };
      }
      return { mode: grid.mode, ...(memories ? { perspectiveMemories: memories } : {}) };
    }
    if (isLegacyGridSettings(grid)) {
      return { mode: grid.enabled ? 'normal' : 'none' };
    }
  }
  return DEFAULT_GUIDE_STATE.grid;
}
