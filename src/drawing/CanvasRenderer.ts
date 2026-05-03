import { STROKE_WIDTH } from './constants';
import type { Point, Stroke } from './types';

export interface CanvasRendererOptions {
  strokeColor: string;
  strokeWidth: number;
  highlightColor: string;
  highlightWidth: number;
  backgroundColor: string;
}

const DEFAULT_OPTIONS: CanvasRendererOptions = {
  strokeColor: '#000000',
  strokeWidth: STROKE_WIDTH,
  highlightColor: '#ff4444',
  highlightWidth: 4,
  backgroundColor: '#ffffff',
};

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private options: CanvasRendererOptions;

  constructor(ctx: CanvasRenderingContext2D, options?: Partial<CanvasRendererOptions>) {
    this.ctx = ctx;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  clear(): void {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawStroke(stroke: Stroke, color?: string, width?: number): void {
    const points = stroke.points;
    if (points.length < 2) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = color ?? this.options.strokeColor;
    this.ctx.lineWidth = width ?? this.options.strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.stroke();
  }

  drawStrokes(strokes: readonly Stroke[]): void {
    for (const stroke of strokes) {
      this.drawStroke(stroke);
    }
  }

  drawHighlightedStroke(stroke: Stroke): void {
    this.drawStroke(stroke, this.options.highlightColor, this.options.highlightWidth);
  }

  /**
   * Draw the in-progress lasso selection path with a "marching ants" style
   * dashed border. The path is rendered as implicitly closed (a segment from
   * the last point back to the first is drawn).
   *
   * @param points Lasso vertices in the current ctx coordinate space.
   * @param dashPhase Animation offset; callers increment over time so the
   *   dashes appear to march.
   * @param lineWidth Width in the same coordinate space as `points` — pass a
   *   value pre-divided by zoom so the line stays visually constant.
   */
  drawLasso(points: readonly Point[], dashPhase: number, lineWidth: number): void {
    if (points.length < 2) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    // Outer light pass for contrast against any background.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([6 * lineWidth, 4 * lineWidth]);

    ctx.lineDashOffset = -dashPhase;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    ctx.lineDashOffset = -dashPhase + 5 * lineWidth;
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.95)';
    ctx.stroke();

    ctx.restore();
  }

  /** Draw points incrementally (for the current in-progress stroke). */
  drawPoints(points: readonly Point[], fromIndex: number): void {
    if (fromIndex >= points.length - 1) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = this.options.strokeColor;
    this.ctx.lineWidth = this.options.strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const start = Math.max(0, fromIndex);
    this.ctx.moveTo(points[start].x, points[start].y);
    for (let i = start + 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.stroke();
  }
}
