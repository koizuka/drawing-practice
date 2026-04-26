import type { Stroke } from '../drawing/types'

const THUMBNAIL_SIZE = 200

export function generateThumbnail(strokes: readonly Stroke[]): string {
  if (strokes.length === 0) return ''

  // Find bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }

  const width = maxX - minX || 1
  const height = maxY - minY || 1
  const padding = Math.max(width, height) * 0.05

  const totalWidth = width + padding * 2
  const totalHeight = height + padding * 2
  const scale = Math.min(THUMBNAIL_SIZE / totalWidth, THUMBNAIL_SIZE / totalHeight)

  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_SIZE
  canvas.height = THUMBNAIL_SIZE
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)

  // Center the drawing
  const scaledWidth = totalWidth * scale
  const scaledHeight = totalHeight * scale
  const offsetX = (THUMBNAIL_SIZE - scaledWidth) / 2
  const offsetY = (THUMBNAIL_SIZE - scaledHeight) / 2

  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  ctx.translate(-minX + padding, -minY + padding)

  ctx.strokeStyle = '#000000'
  ctx.lineWidth = Math.max(2, 0.75 / scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
  }

  return canvas.toDataURL('image/png')
}
