import { db, type SketchfabSearchHistoryEntry } from './db';
import { selectKeysToEvict } from './historyEviction';
import type { SketchfabCategorySlug, SketchfabTimeFilter } from '../utils/sketchfab';

const SKETCHFAB_SEARCH_HISTORY_LIMIT = 50;

function makeKey(query: string, category?: SketchfabCategorySlug): string {
  return `${query.trim().toLowerCase()}|${category ?? ''}`;
}

/**
 * Upsert a search history entry. Deduped by `query|category` so the same
 * keyword run inside two different categories produces two rows, and a
 * category-only browse (empty query) gets its own dedup row per category.
 * The most recent timeFilter wins. The displayed query keeps the user's
 * original casing. Both query and category empty is rejected since the
 * resulting key would collide across all such entries.
 */
export async function addSketchfabSearchHistory(
  query: string,
  timeFilter: SketchfabTimeFilter,
  category?: SketchfabCategorySlug,
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed && !category) return;
  const entry: SketchfabSearchHistoryEntry = {
    key: makeKey(trimmed, category),
    query: trimmed,
    timeFilter,
    lastUsedAt: new Date(),
  };
  if (category) entry.category = category;
  await db.sketchfabSearchHistory.put(entry);

  const all = await db.sketchfabSearchHistory.toArray();
  const toDelete = selectKeysToEvict(all, SKETCHFAB_SEARCH_HISTORY_LIMIT, e => e.key, e => e.lastUsedAt.getTime());
  if (toDelete.length > 0) await db.sketchfabSearchHistory.bulkDelete(toDelete);
}

export async function getSketchfabSearchHistory(): Promise<SketchfabSearchHistoryEntry[]> {
  return db.sketchfabSearchHistory.orderBy('lastUsedAt').reverse().toArray();
}

export async function deleteSketchfabSearchHistory(key: string): Promise<void> {
  await db.sketchfabSearchHistory.delete(key);
}
