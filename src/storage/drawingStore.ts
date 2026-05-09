import { db, type DrawingRecord, COORD_VERSION_CURRENT } from './db';
import type { Stroke } from '../drawing/types';
import { quantizeStroke } from '../drawing/quantize';
import type { ReferenceInfo } from '../types';

/**
 * Snap coordinates to 0.1px and drop collapsed points. Strokes coming from
 * StrokeManager are already quantized at input time, so this is a no-op for
 * the live path; kept as defense-in-depth for any code path that bypasses the
 * manager (e.g. legacy data loaded outside the loadState flow).
 */
export function quantizeStrokesForStorage(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map(quantizeStroke);
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
  });
  return id as number;
}

export async function getAllDrawings(): Promise<DrawingRecord[]> {
  return await db.drawings.orderBy('createdAt').reverse().toArray();
}

export async function deleteDrawing(id: number): Promise<void> {
  await db.drawings.delete(id);
}
