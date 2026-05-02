import { db, type DrawingRecord, COORD_VERSION_CURRENT } from './db'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from '../types'

const QUANTIZE_FACTOR = 10

// Round half away from zero so positive and negative coordinates quantize
// symmetrically around the origin. Math.round biases toward +Infinity at exact
// halves (Math.round(0.5) === 1, Math.round(-0.5) === 0), which would shift
// strokes toward the origin asymmetrically once world coords can be negative.
function quantize(v: number): number {
  const sign = v < 0 ? -1 : 1
  return sign * Math.round(Math.abs(v) * QUANTIZE_FACTOR) / QUANTIZE_FACTOR
}

/**
 * Reduce on-disk size for saved drawings by snapping coordinates to 0.1px and
 * dropping points that collapse onto the previous point after quantization.
 * Shape is preserved (no RDP-style approximation). Applied only when persisting
 * to the drawings table; in-memory strokes and the autosave session draft are
 * untouched.
 */
export function quantizeStrokesForStorage(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map(stroke => {
    const out: Stroke['points'] = []
    let prevX = NaN
    let prevY = NaN
    for (const p of stroke.points) {
      const x = quantize(p.x)
      const y = quantize(p.y)
      if (x === prevX && y === prevY) continue
      out.push({ x, y })
      prevX = x
      prevY = y
    }
    return { points: out, timestamp: stroke.timestamp }
  })
}

export async function saveDrawing(
  strokes: readonly Stroke[],
  thumbnail: string,
  reference: ReferenceInfo | null,
  elapsedMs: number,
): Promise<number> {
  const id = await db.drawings.add({
    strokes: quantizeStrokesForStorage(strokes),
    thumbnail,
    referenceInfo: reference?.title ?? '',
    reference: reference ?? undefined,
    createdAt: new Date(),
    elapsedMs,
    coordVersion: COORD_VERSION_CURRENT,
  })
  return id as number
}

export async function getAllDrawings(): Promise<DrawingRecord[]> {
  return await db.drawings.orderBy('createdAt').reverse().toArray()
}

export async function getDrawing(id: number): Promise<DrawingRecord | undefined> {
  return await db.drawings.get(id)
}

export async function deleteDrawing(id: number): Promise<void> {
  await db.drawings.delete(id)
}

export async function getDrawingCount(): Promise<number> {
  return await db.drawings.count()
}
