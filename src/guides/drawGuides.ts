import type { GridSettings, GuideLine } from './types'
import type { Point } from '../drawing/types'

const GRID_COLOR = 'rgba(0, 150, 255, 0.15)'
const GUIDE_COLOR = 'rgba(255, 50, 50, 0.6)'
const GUIDE_WIDTH = 1

/**
 * Draw grid in canvas/world coordinate space.
 * The caller should have already applied the view transform to ctx.
 * visibleTopLeft/visibleBottomRight define the visible area in world coordinates.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: GridSettings,
  visibleTopLeft: Point,
  visibleBottomRight: Point,
  scale: number,
): void {
  if (!grid.enabled || grid.spacing <= 0) return

  ctx.save()
  ctx.strokeStyle = GRID_COLOR
  // Keep grid line width constant on screen regardless of zoom
  ctx.lineWidth = 1 / scale

  const spacing = grid.spacing
  const startX = Math.floor(visibleTopLeft.x / spacing) * spacing
  const endX = visibleBottomRight.x
  const startY = Math.floor(visibleTopLeft.y / spacing) * spacing
  const endY = visibleBottomRight.y

  // Vertical lines
  for (let x = startX; x <= endX; x += spacing) {
    ctx.beginPath()
    ctx.moveTo(x, startY)
    ctx.lineTo(x, endY)
    ctx.stroke()
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += spacing) {
    ctx.beginPath()
    ctx.moveTo(startX, y)
    ctx.lineTo(endX, y)
    ctx.stroke()
  }

  ctx.restore()
}

export function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly GuideLine[],
  scale: number,
  highlightId?: string | null,
): void {
  ctx.save()
  ctx.lineCap = 'round'

  for (const line of lines) {
    const isHighlighted = line.id === highlightId
    ctx.strokeStyle = isHighlighted ? 'rgba(255, 0, 0, 0.9)' : GUIDE_COLOR
    ctx.lineWidth = (isHighlighted ? GUIDE_WIDTH * 2 : GUIDE_WIDTH) / scale
    ctx.beginPath()
    ctx.moveTo(line.x1, line.y1)
    ctx.lineTo(line.x2, line.y2)
    ctx.stroke()
  }

  ctx.restore()
}
