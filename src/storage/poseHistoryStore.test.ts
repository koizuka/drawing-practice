import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { PoseHistoryRecord } from './db';
import type { PoseJson } from '../pose/poseTypes';

const { orderedToArrayFn } = vi.hoisted(() => ({
  orderedToArrayFn: vi.fn().mockResolvedValue([]),
}));

vi.mock('./db', () => ({
  db: {
    poseHistory: {
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      toArray: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn(() => ({ reverse: () => ({ toArray: orderedToArrayFn }) })),
    },
  },
}));

import { addPoseHistory, getPoseHistory, touchPoseHistory, deletePoseHistory, POSE_HISTORY_LIMIT } from './poseHistoryStore';
import { db } from './db';

const mockAdd = () => db.poseHistory.add as Mock;
const mockUpdate = () => db.poseHistory.update as Mock;
const mockToArray = () => db.poseHistory.toArray as Mock;
const mockBulkDelete = () => db.poseHistory.bulkDelete as Mock;
const mockDelete = () => db.poseHistory.delete as Mock;

const somePose = {} as PoseJson;

function makeRecord(id: number, lastUsedAtMs: number): PoseHistoryRecord {
  return { id, pose: somePose, createdAt: new Date(0), lastUsedAt: new Date(lastUsedAtMs) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockToArray().mockResolvedValue([]);
  orderedToArrayFn.mockResolvedValue([]);
});

describe('addPoseHistory', () => {
  it('adds the entry with lastUsedAt initialized to createdAt', async () => {
    const createdAt = new Date(1000);
    await addPoseHistory({ pose: somePose, hint: 'running', createdAt });
    expect(mockAdd()).toHaveBeenCalledWith({ pose: somePose, hint: 'running', createdAt, lastUsedAt: createdAt });
  });

  it('does not evict while at or under the limit', async () => {
    mockToArray().mockResolvedValue(
      Array.from({ length: POSE_HISTORY_LIMIT }, (_, i) => makeRecord(i + 1, i)),
    );
    await addPoseHistory({ pose: somePose, createdAt: new Date(1000) });
    expect(mockBulkDelete()).not.toHaveBeenCalled();
  });

  it('evicts the least-recently-used entries past the limit', async () => {
    // Deliberately unsorted so eviction must sort by lastUsedAt, not id order.
    const rows = [
      makeRecord(3, 300),
      makeRecord(1, 100),
      makeRecord(2, 200),
      ...Array.from({ length: POSE_HISTORY_LIMIT - 1 }, (_, i) => makeRecord(i + 10, 1000 + i)),
    ];
    mockToArray().mockResolvedValue(rows);
    await addPoseHistory({ pose: somePose, createdAt: new Date(9999) });
    expect(mockBulkDelete()).toHaveBeenCalledWith([1, 2]);
  });
});

describe('getPoseHistory', () => {
  it('returns entries most recently used first via the lastUsedAt index', async () => {
    const rows = [makeRecord(2, 200), makeRecord(1, 100)];
    orderedToArrayFn.mockResolvedValue(rows);
    const result = await getPoseHistory();
    expect(db.poseHistory.orderBy).toHaveBeenCalledWith('lastUsedAt');
    expect(result).toEqual(rows);
  });
});

describe('touchPoseHistory', () => {
  it('bumps lastUsedAt', async () => {
    const before = Date.now();
    await touchPoseHistory(7);
    const [id, changes] = mockUpdate().mock.calls[0] as [number, { lastUsedAt: Date }];
    expect(id).toBe(7);
    expect(changes.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('deletePoseHistory', () => {
  it('deletes by id', async () => {
    await deletePoseHistory(7);
    expect(mockDelete()).toHaveBeenCalledWith(7);
  });
});
