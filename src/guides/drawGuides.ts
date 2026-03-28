import type { GridSettings, GuideLine } from './types'
import type { Point } from '../drawing/types'

const GRID_COLOR = 'rgba(0, 150, 255, 0.35)'
const GRID_ORIGIN_COLOR = 'rgba(0, 150, 255, 0.6)'
const GUIDE_COLOR = 'rgba(255, 50, 50, 0.6)'
const GUIDE_WIDTH = 1

/**
 * Draw grid in canvas/world coordinate space.
 * The caller should have already applied the view transform to ctx.
 * visibleTopLeft/visibleBottomRight define the visible area in world coordinates.
 */
/**
 * Draw grid in canvas/world coordinate space.
 * center: the grid line nearest to this point will be drawn as a thick center line.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: GridSettings,
  visibleTopLeft: Point,
  visibleBottomRight: Point,
  scale: number,
  center?: Point,
): void {
  if (!grid.enabled || grid.spacing <= 0) return

  ctx.save()

  const spacing = grid.spacing
  const startX = Math.floor(visibleTopLeft.x / spacing) * spacing
  const endX = visibleBottomRight.x
  const startY = Math.floor(visibleTopLeft.y / spacing) * spacing
  const endY = visibleBottomRight.y

  const normalWidth = 1 / scale
  const originWidth = 3 / scale

  // Snap center to nearest grid line
  const centerX = center ? Math.round(center.x / spacing) * spacing : null
  const centerY = center ? Math.round(center.y / spacing) * spacing : null

  // Vertical lines
  for (let x = startX; x <= endX; x += spacing) {
    const isCenter = centerX !== null && Math.abs(x - centerX) < spacing * 0.01
    ctx.strokeStyle = isCenter ? GRID_ORIGIN_COLOR : GRID_COLOR
    ctx.lineWidth = isCenter ? originWidth : normalWidth
    ctx.beginPath()
    ctx.moveTo(x, startY)
    ctx.lineTo(x, endY)
    ctx.stroke()
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += spacing) {
    const isCenter = centerY !== null && Math.abs(y - centerY) < spacing * 0.01
    ctx.strokeStyle = isCenter ? GRID_ORIGIN_COLOR : GRID_COLOR
    ctx.lineWidth = isCenter ? originWidth : normalWidth
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
