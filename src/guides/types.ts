export interface GuideLine {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export type GridMode = 'none' | 'normal' | 'large'

export interface GridSettings {
  mode: GridMode
}

export interface GuideState {
  grid: GridSettings
  lines: GuideLine[]
}

export const DEFAULT_GUIDE_STATE: GuideState = {
  grid: { mode: 'none' },
  lines: [],
}

export const NORMAL_GRID_SPACING = 100

const GRID_SPACINGS: Record<GridMode, number> = {
  none: 0,
  normal: 100,
  large: 200,
}

export function getGridSpacing(mode: GridMode): number {
  return GRID_SPACINGS[mode]
}

const GRID_MODE_CYCLE: GridMode[] = ['none', 'normal', 'large']

export function nextGridMode(current: GridMode): GridMode {
  const idx = GRID_MODE_CYCLE.indexOf(current)
  return GRID_MODE_CYCLE[(idx + 1) % GRID_MODE_CYCLE.length]
}

/** Migrate legacy { enabled, spacing } format to { mode } */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateGridSettings(grid: any): GridSettings {
  if (grid && typeof grid.mode === 'string') return grid as GridSettings
  // Legacy format: { enabled: boolean, spacing: number }
  if (grid && typeof grid.enabled === 'boolean') {
    return { mode: grid.enabled ? 'normal' : 'none' }
  }
  return DEFAULT_GUIDE_STATE.grid
}
