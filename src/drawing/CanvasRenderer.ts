import type { Point, Stroke } from './types'

export interface CanvasRendererOptions {
  strokeColor: string
  strokeWidth: number
  highlightColor: string
  highlightWidth: number
  backgroundColor: string
}

const DEFAULT_OPTIONS: CanvasRendererOptions = {
  strokeColor: '#000000',
  strokeWidth: 2,
  highlightColor: '#ff4444',
  highlightWidth: 4,
  backgroundColor: '#ffffff',
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D
  private options: CanvasRendererOptions

  constructor(ctx: CanvasRenderingContext2D, options?: Partial<CanvasRendererOptions>) {
    this.ctx = ctx
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  clear(): void {
    const canvas = this.ctx.canvas
    this.ctx.fillStyle = this.options.backgroundColor
    this.ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  drawStroke(stroke: Stroke, color?: string, width?: number): void {
    const points = stroke.points
    if (points.length < 2) return

    this.ctx.beginPath()
    this.ctx.strokeStyle = color ?? this.options.strokeColor
    this.ctx.lineWidth = width ?? this.options.strokeWidth
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'

    this.ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y)
    }
    this.ctx.stroke()
  }

  drawStrokes(strokes: readonly Stroke[]): void {
    for (const stroke of strokes) {
      this.drawStroke(stroke)
    }
  }

  drawHighlightedStroke(stroke: Stroke): void {
    this.drawStroke(stroke, this.options.highlightColor, this.options.highlightWidth)
  }

  /** Draw points incrementally (for the current in-progress stroke). */
  drawPoints(points: readonly Point[], fromIndex: number): void {
    if (fromIndex >= points.length - 1) return

    this.ctx.beginPath()
    this.ctx.strokeStyle = this.options.strokeColor
    this.ctx.lineWidth = this.options.strokeWidth
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'

    const start = Math.max(0, fromIndex)
    this.ctx.moveTo(points[start].x, points[start].y)
    for (let i = start + 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y)
    }
    this.ctx.stroke()
  }
}
