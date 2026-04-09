import type { Point, Stroke } from './types'

/** An entry on the undo stack records one reversible action. */
type UndoEntry =
  | { type: 'add' }
  | { type: 'delete'; stroke: Stroke; index: number }

/** An entry on the redo stack stores enough data to replay the action. */
type RedoEntry =
  | { type: 'add'; stroke: Stroke }
  | { type: 'delete'; stroke: Stroke; index: number }

export class StrokeManager {
  private strokes: Stroke[] = []
  private undoStack: UndoEntry[] = []
  private redoStack: RedoEntry[] = []
  private currentStroke: Stroke | null = null

  startStroke(point: Point): void {
    this.currentStroke = {
      points: [point],
      timestamp: Date.now(),
    }
  }

  appendStroke(point: Point): void {
    if (!this.currentStroke) return
    this.currentStroke.points.push(point)
  }

  endStroke(): Stroke | null {
    if (!this.currentStroke) return null
    if (this.currentStroke.points.length < 2) {
      this.currentStroke = null
      return null
    }
    const stroke = this.currentStroke
    this.strokes.push(stroke)
    this.undoStack.push({ type: 'add' })
    this.redoStack = []
    this.currentStroke = null
    return stroke
  }

  getCurrentStroke(): Stroke | null {
    return this.currentStroke
  }

  getStrokes(): readonly Stroke[] {
    return this.strokes
  }

  undo(): Stroke | null {
    const entry = this.undoStack.pop()
    if (!entry) return null

    if (entry.type === 'add') {
      const stroke = this.strokes.pop()!
      this.redoStack.push({ type: 'add', stroke })
      return stroke
    } else {
      this.strokes.splice(entry.index, 0, entry.stroke)
      this.redoStack.push({ type: 'delete', stroke: entry.stroke, index: entry.index })
      return entry.stroke
    }
  }

  redo(): Stroke | null {
    const entry = this.redoStack.pop()
    if (!entry) return null

    if (entry.type === 'add') {
      this.strokes.push(entry.stroke)
      this.undoStack.push({ type: 'add' })
      return entry.stroke
    } else {
      const [removed] = this.strokes.splice(entry.index, 1)
      this.undoStack.push({ type: 'delete', stroke: removed, index: entry.index })
      return removed
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  deleteStroke(index: number): Stroke | null {
    if (index < 0 || index >= this.strokes.length) return null
    const [removed] = this.strokes.splice(index, 1)
    this.undoStack.push({ type: 'delete', stroke: removed, index })
    this.redoStack = []
    return removed
  }

  /** Find the nearest stroke to a point within the given threshold distance. */
  findNearestStroke(point: Point, threshold: number): number | null {
    let bestIndex: number | null = null
    let bestDist = threshold

    for (let i = 0; i < this.strokes.length; i++) {
      const stroke = this.strokes[i]
      for (const p of stroke.points) {
        const dx = p.x - point.x
        const dy = p.y - point.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < bestDist) {
          bestDist = dist
          bestIndex = i
        }
      }
    }

    return bestIndex
  }

  loadState(strokes: Stroke[], redoStack: Stroke[]): void {
    this.strokes = [...strokes]
    this.undoStack = strokes.map(() => ({ type: 'add' as const }))
    this.redoStack = redoStack.map(stroke => ({ type: 'add' as const, stroke }))
    this.currentStroke = null
  }

  getRedoStack(): readonly Stroke[] {
    return this.redoStack
      .filter((e): e is RedoEntry & { type: 'add' } => e.type === 'add')
      .map(e => e.stroke)
  }

  clear(): void {
    this.strokes = []
    this.undoStack = []
    this.redoStack = []
    this.currentStroke = null
  }
}
