import { db, type PoseHistoryRecord } from './db';
import { selectKeysToEvict } from './historyEviction';

export const POSE_HISTORY_LIMIT = 50;

/**
 * Record a successful pose generation. Append-only (no dedup — pose JSON
 * equality is fuzzy and repeat generations are legitimately distinct); the
 * least-recently-used entries are evicted past POSE_HISTORY_LIMIT.
 * `lastUsedAt` is initialized to the entry's createdAt.
 */
export async function addPoseHistory(entry: Omit<PoseHistoryRecord, 'id' | 'lastUsedAt'>): Promise<void> {
  await db.poseHistory.add({ ...entry, lastUsedAt: entry.createdAt } as PoseHistoryRecord);
  const rows = await db.poseHistory.toArray();
  const evictKeys = selectKeysToEvict(
    rows,
    POSE_HISTORY_LIMIT,
    row => row.id,
    row => row.lastUsedAt.getTime(),
  ).filter((id): id is number => id !== undefined);
  if (evictKeys.length > 0) {
    await db.poseHistory.bulkDelete(evictKeys);
  }
}

/** All saved poses, most recently used first. */
export async function getPoseHistory(): Promise<PoseHistoryRecord[]> {
  return db.poseHistory.orderBy('lastUsedAt').reverse().toArray();
}

/**
 * LRU bump: mark the entry as just used so it sorts to the top and survives
 * eviction. Called when a history entry is re-applied to the mannequin.
 */
export async function touchPoseHistory(id: number): Promise<void> {
  await db.poseHistory.update(id, { lastUsedAt: new Date() });
}

export async function deletePoseHistory(id: number): Promise<void> {
  await db.poseHistory.delete(id);
}
