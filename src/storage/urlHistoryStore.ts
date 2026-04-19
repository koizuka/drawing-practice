import { db, type UrlHistoryEntry, type UrlHistoryType } from './db'
import { buildYouTubeCanonicalUrl, parseYouTubeVideoId } from '../utils/youtube'

export const URL_HISTORY_LIMIT = 50

/**
 * Collapse surface variants of the same logical reference onto a single key so
 * the history dedupes by identity, not by literal URL. Currently only YouTube
 * needs this — `youtu.be/X`, `youtube.com/watch?v=X`, and the same URL with
 * extra query params (e.g. `&t=30s`) all point to the same video.
 */
function canonicalizeUrl(url: string, type: UrlHistoryType): string {
  if (type === 'youtube') {
    const id = parseYouTubeVideoId(url)
    if (id) return buildYouTubeCanonicalUrl(id)
  }
  return url
}

/**
 * Upsert a history entry. If `title` is omitted but an existing entry has one,
 * the old title is preserved so a late or failed title fetch doesn't clobber
 * what we already knew.
 */
export async function addUrlHistory(url: string, type: UrlHistoryType, title?: string): Promise<void> {
  const key = canonicalizeUrl(url, type)
  let finalTitle = title?.trim() || undefined
  if (!finalTitle) {
    const existing = await db.urlHistory.get(key)
    finalTitle = existing?.title
  }
  const entry: UrlHistoryEntry = { url: key, type, lastUsedAt: new Date() }
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
