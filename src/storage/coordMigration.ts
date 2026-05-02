import type { Stroke } from '../drawing/types'
import type { GuideLine, GuideState } from '../guides/types'

/**
 * Translate every coordinate by `(dx, dy)`. Used to migrate legacy stored
 * strokes / guide lines from "world origin = content top-left" to "world
 * origin = content center" by passing `(-W/2, -H/2)`.
 */
function shiftStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return {
    points: stroke.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
    timestamp: stroke.timestamp,
  }
}

function shiftGuideLine(line: GuideLine, dx: number, dy: number): GuideLine {
  return {
    ...line,
    x1: line.x1 + dx,
    y1: line.y1 + dy,
    x2: line.x2 + dx,
    y2: line.y2 + dy,
  }
}

export function shiftStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map(s => shiftStroke(s, dx, dy))
}

export function shiftGuideState(state: GuideState, dx: number, dy: number): GuideState {
  return {
    grid: state.grid,
    lines: state.lines.map(l => shiftGuideLine(l, dx, dy)),
  }
}
