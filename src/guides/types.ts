export interface GuideLine {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GridSettings {
  enabled: boolean
  spacing: number
}

export interface GuideState {
  grid: GridSettings
  lines: GuideLine[]
}

export const DEFAULT_GUIDE_STATE: GuideState = {
  grid: { enabled: false, spacing: 100 },
  lines: [],
}
