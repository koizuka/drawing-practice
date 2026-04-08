import type { GridSettings, GuideLine } from './types'
import { getGridSpacing } from './types'
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
  if (grid.mode === 'none') return

  const spacing = getGridSpacing(grid.mode)
  if (spacing <= 0) return

  ctx.save()

  const normalWidth = 1 / scale
  const originWidth = 3 / scale

  // Use the exact center as the grid origin so that
  // a grid line always passes through the center point.
  const originX = center ? center.x : 0
  const originY = center ? center.y : 0

  const startX = originX + Math.floor((visibleTopLeft.x - originX) / spacing) * spacing
  const endX = visibleBottomRight.x
  const startY = originY + Math.floor((visibleTopLeft.y - originY) / spacing) * spacing
  const endY = visibleBottomRight.y

  // Vertical lines
  for (let x = startX; x <= endX; x += spacing) {
    const isCenter = center != null && Math.abs(x - originX) < spacing * 0.01
    ctx.strokeStyle = isCenter ? GRID_ORIGIN_COLOR : GRID_COLOR
    ctx.lineWidth = isCenter ? originWidth : normalWidth
    ctx.beginPath()
    ctx.moveTo(x, startY)
    ctx.lineTo(x, endY)
    ctx.stroke()
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += spacing) {
    const isCenter = center != null && Math.abs(y - originY) < spacing * 0.01
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
