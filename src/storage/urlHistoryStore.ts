import { db, type UrlHistoryEntry, type UrlHistoryType } from './db'
import { buildYouTubeCanonicalUrl, parseYouTubeVideoId } from '../utils/youtube'

export const URL_HISTORY_LIMIT = 50
// Images are stored with their Blob, so each entry can be 200KB–1.5MB.
// A separate, smaller cap keeps the worst-case storage bounded (~15MB) and
// prevents a burst of image opens from evicting YouTube/URL history.
export const URL_HISTORY_IMAGE_LIMIT = 10

export interface AddUrlHistoryOptions {
  title?: string
  fileName?: string
  imageBlob?: Blob
  thumbnailUrl?: string
}

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

function normalizeOptions(titleOrOptions?: string | AddUrlHistoryOptions): AddUrlHistoryOptions {
  if (typeof titleOrOptions === 'string') return { title: titleOrOptions }
  return titleOrOptions ?? {}
}

/**
 * Upsert a history entry. Fields that are omitted but present on an existing
 * entry (title, fileName, imageBlob) are preserved so a partial re-touch (e.g.
 * bumping `lastUsedAt` on selection without re-resizing the image) doesn't
 * clobber what we already have.
 */
export async function addUrlHistory(
  url: string,
  type: UrlHistoryType,
  titleOrOptions?: string | AddUrlHistoryOptions,
): Promise<void> {
  const opts = normalizeOptions(titleOrOptions)
  const key = canonicalizeUrl(url, type)

  let finalTitle = opts.title?.trim() || undefined
  let finalFileName = opts.fileName
  let finalBlob = opts.imageBlob
  let finalThumbnailUrl = opts.thumbnailUrl
  // Only fall back to the stored thumbnailUrl for types that actually persist
  // it (currently just 'pexels'); for url/youtube the dropdown derives the
  // thumbnail at render time, so a lookup here would just cost a DB read.
  const needsThumbnailLookup = type === 'pexels' && !finalThumbnailUrl
  if (
    !finalTitle ||
    needsThumbnailLookup ||
    (type === 'image' && (!finalFileName || !finalBlob))
  ) {
    const existing = await db.urlHistory.get(key)
    if (!finalTitle) finalTitle = existing?.title
    if (!finalFileName) finalFileName = existing?.fileName
    if (!finalBlob) finalBlob = existing?.imageBlob
    if (!finalThumbnailUrl) finalThumbnailUrl = existing?.thumbnailUrl
  }

  const entry: UrlHistoryEntry = { url: key, type, lastUsedAt: new Date() }
  if (finalTitle) entry.title = finalTitle
  if (finalFileName) entry.fileName = finalFileName
  if (finalBlob) entry.imageBlob = finalBlob
  if (finalThumbnailUrl) entry.thumbnailUrl = finalThumbnailUrl
  await db.urlHistory.put(entry)

  const all = await db.urlHistory.toArray()
  const images: UrlHistoryEntry[] = []
  const others: UrlHistoryEntry[] = []
  for (const e of all) {
    if (e.type === 'image') images.push(e)
    else others.push(e)
  }
  const toDelete: string[] = []
  if (images.length > URL_HISTORY_IMAGE_LIMIT) {
    const sorted = [...images].sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
    for (const e of sorted.slice(0, images.length - URL_HISTORY_IMAGE_LIMIT)) toDelete.push(e.url)
  }
  if (others.length > URL_HISTORY_LIMIT) {
    const sorted = [...others].sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
    for (const e of sorted.slice(0, others.length - URL_HISTORY_LIMIT)) toDelete.push(e.url)
  }
  if (toDelete.length > 0) {
    await db.urlHistory.bulkDelete(toDelete)
  }
}

export async function getUrlHistory(): Promise<UrlHistoryEntry[]> {
  return db.urlHistory.orderBy('lastUsedAt').reverse().toArray()
}

export async function getUrlHistoryEntry(url: string): Promise<UrlHistoryEntry | undefined> {
  return db.urlHistory.get(url)
}

export async function deleteUrlHistory(url: string): Promise<void> {
  await db.urlHistory.delete(url)
}
