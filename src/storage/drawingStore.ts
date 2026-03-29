import { db, type DrawingRecord } from './db'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from '../components/SketchfabViewer'

export async function saveDrawing(
  strokes: readonly Stroke[],
  thumbnail: string,
  reference: ReferenceInfo | null,
  elapsedMs: number,
): Promise<number> {
  const id = await db.drawings.add({
    strokes: [...strokes],
    thumbnail,
    referenceInfo: reference?.title ?? '',
    reference: reference ?? undefined,
    createdAt: new Date(),
    elapsedMs,
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
