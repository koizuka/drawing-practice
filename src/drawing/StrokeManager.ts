import type { Point, Stroke } from './types'

export class StrokeManager {
  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
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
    const stroke = this.strokes.pop()
    if (!stroke) return null
    this.redoStack.push(stroke)
    return stroke
  }

  redo(): Stroke | null {
    const stroke = this.redoStack.pop()
    if (!stroke) return null
    this.strokes.push(stroke)
    return stroke
  }

  canUndo(): boolean {
    return this.strokes.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  deleteStroke(index: number): Stroke | null {
    if (index < 0 || index >= this.strokes.length) return null
    const [removed] = this.strokes.splice(index, 1)
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

  clear(): void {
    this.strokes = []
    this.redoStack = []
    this.currentStroke = null
  }
}
