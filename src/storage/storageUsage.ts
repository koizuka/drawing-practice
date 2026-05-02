import { db, type DrawingRecord } from './db';

export interface StorageUsage {
  drawings: {
    strokes: number;
    thumbnails: number;
    sketchfabImages: number;
    drawingCount: number;
    strokeCount: number;
    pointCount: number;
  };
  urlHistoryImageBytes: number;
  sessionBytes: number;
  estimateUsage: number | null;
  estimateQuota: number | null;
}

function jsonByteSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

function computeDrawingsBreakdown(drawings: readonly DrawingRecord[]): StorageUsage['drawings'] {
  let strokes = 0;
  let thumbnails = 0;
  let sketchfabImages = 0;
  let strokeCount = 0;
  let pointCount = 0;
  for (const d of drawings) {
    strokes += jsonByteSize(d.strokes);
    thumbnails += d.thumbnail.length;
    strokeCount += d.strokes.length;
    for (const s of d.strokes) {
      pointCount += s.points.length;
    }
    if (d.reference?.source === 'sketchfab' && d.reference.imageUrl) {
      sketchfabImages += d.reference.imageUrl.length;
    }
  }
  return {
    strokes,
    thumbnails,
    sketchfabImages,
    drawingCount: drawings.length,
    strokeCount,
    pointCount,
  };
}

async function sumUrlHistoryImageBytes(): Promise<number> {
  let total = 0;
  await db.urlHistory.each((e) => {
    if (e.imageBlob) total += e.imageBlob.size;
  });
  return total;
}

async function getSessionBytes(): Promise<number> {
  const s = await db.session.get(1);
  return s ? jsonByteSize(s) : 0;
}

async function getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? null, quota: est.quota ?? null };
  }
  catch {
    return { usage: null, quota: null };
  }
}

/**
 * Sizes use UTF-8 byte length; the on-disk footprint may differ since
 * IndexedDB stores strings as UTF-16, but the relative breakdown is what
 * users want to see.
 */
export async function computeStorageUsage(drawings: readonly DrawingRecord[]): Promise<StorageUsage> {
  const [urlHistoryImageBytes, sessionBytes, estimate] = await Promise.all([
    sumUrlHistoryImageBytes(),
    getSessionBytes(),
    getStorageEstimate(),
  ]);
  return {
    drawings: computeDrawingsBreakdown(drawings),
    urlHistoryImageBytes,
    sessionBytes,
    estimateUsage: estimate.usage,
    estimateQuota: estimate.quota,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
