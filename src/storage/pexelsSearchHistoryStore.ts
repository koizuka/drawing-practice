import { db, type PexelsSearchHistoryEntry } from './db'
import type { PexelsOrientationFilter } from '../utils/pexels'

export const PEXELS_SEARCH_HISTORY_LIMIT = 50

function makeKey(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * Upsert a search history entry. Deduped by lowercased trimmed query so
 * "Ballet" and "ballet" share a row; the most recent orientation wins. The
 * displayed query keeps the user's original casing.
 */
export async function addPexelsSearchHistory(
  query: string,
  orientation: PexelsOrientationFilter,
): Promise<void> {
  const trimmed = query.trim()
  if (!trimmed) return
  const entry: PexelsSearchHistoryEntry = {
    key: makeKey(trimmed),
    query: trimmed,
    orientation,
    lastUsedAt: new Date(),
  }
  await db.pexelsSearchHistory.put(entry)

  const all = await db.pexelsSearchHistory.toArray()
  if (all.length > PEXELS_SEARCH_HISTORY_LIMIT) {
    const sorted = [...all].sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
    const toDelete = sorted
      .slice(0, all.length - PEXELS_SEARCH_HISTORY_LIMIT)
      .map(e => e.key)
    await db.pexelsSearchHistory.bulkDelete(toDelete)
  }
}

export async function getPexelsSearchHistory(): Promise<PexelsSearchHistoryEntry[]> {
  return db.pexelsSearchHistory.orderBy('lastUsedAt').reverse().toArray()
}

export async function deletePexelsSearchHistory(key: string): Promise<void> {
  await db.pexelsSearchHistory.delete(key)
}
