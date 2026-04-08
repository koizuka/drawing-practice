import type { GuideLine, GridSettings, GridMode, GuideState } from './types'
import { DEFAULT_GUIDE_STATE, nextGridMode, migrateGridSettings } from './types'

let nextId = 1

export class GuideManager {
  private state: GuideState

  constructor(initial?: GuideState) {
    this.state = initial ? { ...initial, lines: [...initial.lines] } : { ...DEFAULT_GUIDE_STATE, lines: [] }
  }

  getState(): GuideState {
    return this.state
  }

  getGrid(): GridSettings {
    return this.state.grid
  }

  setGridMode(mode: GridMode): void {
    this.state.grid = { mode }
  }

  cycleGridMode(): void {
    this.state.grid = { mode: nextGridMode(this.state.grid.mode) }
  }

  getLines(): readonly GuideLine[] {
    return this.state.lines
  }

  addLine(x1: number, y1: number, x2: number, y2: number): GuideLine {
    const line: GuideLine = { id: `guide-${nextId++}`, x1, y1, x2, y2 }
    this.state.lines.push(line)
    return line
  }

  removeLine(id: string): boolean {
    const index = this.state.lines.findIndex(l => l.id === id)
    if (index === -1) return false
    this.state.lines.splice(index, 1)
    return true
  }

  clearLines(): void {
    this.state.lines = []
  }

  importState(state: GuideState): void {
    this.state = { grid: migrateGridSettings(state.grid), lines: [...state.lines] }
    // Update nextId to avoid collisions with imported line ids
    for (const line of state.lines) {
      const match = line.id.match(/^guide-(\d+)$/)
      if (match) {
        const id = parseInt(match[1], 10)
        if (id >= nextId) nextId = id + 1
      }
    }
  }

  findNearestLine(x: number, y: number, threshold: number): GuideLine | null {
    let best: GuideLine | null = null
    let bestDist = threshold

    for (const line of this.state.lines) {
      const dist = pointToSegmentDistance(x, y, line.x1, line.y1, line.x2, line.y2)
      if (dist < bestDist) {
        bestDist = dist
        best = line
      }
    }

    return best
  }
}

function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    const ex = px - x1
    const ey = py - y1
    return Math.sqrt(ex * ex + ey * ey)
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const closestX = x1 + t * dx
  const closestY = y1 + t * dy
  const ex = px - closestX
  const ey = py - closestY
  return Math.sqrt(ex * ex + ey * ey)
}
