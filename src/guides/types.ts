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

export interface GridSettings {
  mode: GridMode;
  /** Only meaningful when mode === 'perspective', but kept while switching modes. */
  perspective?: PerspectiveSettings;
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
      if (grid.perspective !== undefined || grid.mode === 'perspective') {
        return { mode: grid.mode, perspective: sanitizePerspectiveSettings(grid.perspective) };
      }
      return { mode: grid.mode };
    }
    if (isLegacyGridSettings(grid)) {
      return { mode: grid.enabled ? 'normal' : 'none' };
    }
  }
  return DEFAULT_GUIDE_STATE.grid;
}
