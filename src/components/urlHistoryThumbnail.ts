import type { UrlHistoryEntry } from '../storage/db'
import { parseYouTubeVideoId } from '../utils/youtube'

/**
 * Resolve the dropdown thumbnail src for a history entry, or null when no
 * preview source is available (caller falls back to the type icon).
 *
 * - image: ObjectURL minted from the stored Blob (looked up in the map)
 * - youtube: derived from the canonical video id at render time
 * - url: the entry url itself (these point directly at an image)
 * - pexels: the stored thumbnailUrl (photo.src.tiny), if present
 */
export function resolveHistoryThumbnailSrc(
  entry: UrlHistoryEntry,
  imageObjectUrls: Map<string, string>,
): string | null {
  if (entry.type === 'image') return imageObjectUrls.get(entry.url) ?? null
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url)
    return id ? `https://i.ytimg.com/vi/${id}/default.jpg` : null
  }
  if (entry.type === 'pexels') return entry.thumbnailUrl ?? null
  return entry.url
}
