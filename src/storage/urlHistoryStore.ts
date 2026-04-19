import { db, type UrlHistoryEntry, type UrlHistoryType } from './db'

export const URL_HISTORY_LIMIT = 50

/**
 * Upsert a history entry. If `title` is omitted but an existing entry has one,
 * the old title is preserved so a late or failed title fetch doesn't clobber
 * what we already knew.
 */
export async function addUrlHistory(url: string, type: UrlHistoryType, title?: string): Promise<void> {
  let finalTitle = title?.trim() || undefined
  if (!finalTitle) {
    const existing = await db.urlHistory.get(url)
    finalTitle = existing?.title
  }
  const entry: UrlHistoryEntry = { url, type, lastUsedAt: new Date() }
  if (finalTitle) entry.title = finalTitle
  await db.urlHistory.put(entry)
  const all = await db.urlHistory.toArray()
  if (all.length > URL_HISTORY_LIMIT) {
    const sorted = [...all].sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
    const excess = sorted.slice(0, all.length - URL_HISTORY_LIMIT)
    await db.urlHistory.bulkDelete(excess.map(e => e.url))
  }
}

export async function getUrlHistory(): Promise<UrlHistoryEntry[]> {
  return db.urlHistory.orderBy('lastUsedAt').reverse().toArray()
}

export async function deleteUrlHistory(url: string): Promise<void> {
  await db.urlHistory.delete(url)
}
