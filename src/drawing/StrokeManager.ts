import type { Point, Stroke } from './types'

interface DeleteRecord {
  stroke: Stroke
  index: number
}

export class StrokeManager {
  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
  private currentStroke: Stroke | null = null
  private lastDelete: DeleteRecord | null = null

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
    this.redoStack = []
    this.lastDelete = null
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
    // Undo a delete operation: restore the deleted stroke to its original position
    if (this.lastDelete) {
      const { stroke, index } = this.lastDelete
      this.strokes.splice(index, 0, stroke)
      this.lastDelete = null
      return stroke
    }
    const stroke = this.strokes.pop()
    if (!stroke) return null
    this.redoStack.push(stroke)
    return stroke
  }

  redo(): Stroke | null {
    const stroke = this.redoStack.pop()
    if (!stroke) return null
    this.strokes.push(stroke)
    this.lastDelete = null
    return stroke
  }

  canUndo(): boolean {
    return this.strokes.length > 0 || this.lastDelete !== null
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  deleteStroke(index: number): Stroke | null {
    if (index < 0 || index >= this.strokes.length) return null
    const [removed] = this.strokes.splice(index, 1)
    this.redoStack = []
    this.lastDelete = { stroke: removed, index }
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
    this.redoStack = [...redoStack]
    this.lastDelete = null
    this.currentStroke = null
  }

  getRedoStack(): readonly Stroke[] {
    return this.redoStack
  }

  clear(): void {
    this.strokes = []
    this.redoStack = []
    this.lastDelete = null
    this.currentStroke = null
  }
}
