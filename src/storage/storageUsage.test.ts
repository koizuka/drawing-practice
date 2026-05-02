import { vi } from 'vitest';

vi.mock('./db', () => ({
  db: {
    urlHistory: { each: vi.fn().mockResolvedValue(undefined) },
    session: { get: vi.fn().mockResolvedValue(undefined) },
  },
}));

import { computeStorageUsage } from './storageUsage';
import type { DrawingRecord } from './db';

function makeDrawing(strokes: { points: number; timestamp?: number }[], opts: Partial<DrawingRecord> = {}): DrawingRecord {
  return {
    strokes: strokes.map((s, i) => ({
      points: Array.from({ length: s.points }, (_, k) => ({ x: k, y: k })),
      timestamp: s.timestamp ?? i,
    })),
    thumbnail: 'data:image/png;base64,thumb',
    referenceInfo: '',
    createdAt: new Date(0),
    elapsedMs: 0,
    ...opts,
  };
}

describe('computeStorageUsage / drawings breakdown', () => {
  it('aggregates strokeCount, pointCount, and drawingCount across drawings', async () => {
    const drawings = [
      makeDrawing([{ points: 3 }, { points: 5 }]), // 2 strokes, 8 points
      makeDrawing([{ points: 10 }]), // 1 stroke, 10 points
      makeDrawing([]), // 0 strokes
    ];
    const usage = await computeStorageUsage(drawings);
    expect(usage.drawings.drawingCount).toBe(3);
    expect(usage.drawings.strokeCount).toBe(3);
    expect(usage.drawings.pointCount).toBe(18);
  });

  it('handles empty drawings array without errors', async () => {
    const usage = await computeStorageUsage([]);
    expect(usage.drawings.drawingCount).toBe(0);
    expect(usage.drawings.strokeCount).toBe(0);
    expect(usage.drawings.pointCount).toBe(0);
    expect(usage.drawings.strokes).toBe(0);
    expect(usage.drawings.thumbnails).toBe(0);
  });

  it('computes positive strokes byte size for non-empty strokes', async () => {
    const drawings = [makeDrawing([{ points: 100 }])];
    const usage = await computeStorageUsage(drawings);
    expect(usage.drawings.strokes).toBeGreaterThan(0);
  });
});
