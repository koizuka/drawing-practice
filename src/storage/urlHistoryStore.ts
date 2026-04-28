import { db, type UrlHistoryEntry, type UrlHistoryType } from './db'
import { selectKeysToEvict } from './historyEviction'
import { buildYouTubeCanonicalUrl, parseYouTubeVideoId } from '../utils/youtube'
import type { PexelsLastSearch } from '../utils/pexels'
import type { SketchfabSearchContext } from '../utils/sketchfab'

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
  pexelsSearchContext?: PexelsLastSearch
  sketchfabSearchContext?: SketchfabSearchContext
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
  let finalPexelsSearchContext = opts.pexelsSearchContext
  let finalSketchfabSearchContext = opts.sketchfabSearchContext
  // Only fall back to the stored thumbnailUrl for types that actually persist
  // it (pexels and sketchfab); for url/youtube the dropdown derives the
  // thumbnail at render time, so a lookup here would just cost a DB read.
  const needsThumbnailLookup = (type === 'pexels' || type === 'sketchfab') && !finalThumbnailUrl
  const needsPexelsSearchContextLookup = type === 'pexels' && !finalPexelsSearchContext
  const needsSketchfabSearchContextLookup = type === 'sketchfab' && !finalSketchfabSearchContext
  // Sketchfab entries also persist a Blob (the Fix-Angle screenshot used for
  // dropdown thumbnail and fixed-mode restoration), so a partial re-touch
  // (lastUsedAt bump) must not lose the Blob.
  const needsBlobLookup = (type === 'sketchfab' && !finalBlob)
  if (
    !finalTitle ||
    needsThumbnailLookup ||
    needsPexelsSearchContextLookup ||
    needsSketchfabSearchContextLookup ||
    needsBlobLookup ||
    (type === 'image' && (!finalFileName || !finalBlob))
  ) {
    const existing = await db.urlHistory.get(key)
    if (!finalTitle) finalTitle = existing?.title
    if (!finalFileName) finalFileName = existing?.fileName
    if (!finalBlob) finalBlob = existing?.imageBlob
    if (!finalThumbnailUrl) finalThumbnailUrl = existing?.thumbnailUrl
    if (!finalPexelsSearchContext) finalPexelsSearchContext = existing?.pexelsSearchContext
    if (!finalSketchfabSearchContext) finalSketchfabSearchContext = existing?.sketchfabSearchContext
  }

  const entry: UrlHistoryEntry = { url: key, type, lastUsedAt: new Date() }
  if (finalTitle) entry.title = finalTitle
  if (finalFileName) entry.fileName = finalFileName
  if (finalBlob) entry.imageBlob = finalBlob
  if (finalThumbnailUrl) entry.thumbnailUrl = finalThumbnailUrl
  if (finalPexelsSearchContext) entry.pexelsSearchContext = finalPexelsSearchContext
  if (finalSketchfabSearchContext) entry.sketchfabSearchContext = finalSketchfabSearchContext
  await db.urlHistory.put(entry)

  // Image entries have a smaller cap so a burst of image opens can't evict
  // url/youtube/pexels history. Each bucket evicts independently.
  const all = await db.urlHistory.toArray()
  const images = all.filter(e => e.type === 'image')
  const others = all.filter(e => e.type !== 'image')
  const getKey = (e: UrlHistoryEntry) => e.url
  const getTime = (e: UrlHistoryEntry) => e.lastUsedAt.getTime()
  const toDelete = [
    ...selectKeysToEvict(images, URL_HISTORY_IMAGE_LIMIT, getKey, getTime),
    ...selectKeysToEvict(others, URL_HISTORY_LIMIT, getKey, getTime),
  ]
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
