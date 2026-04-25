import type { UrlHistoryEntry } from '../storage/db'
import { buildYouTubeThumbnailUrl, parseYouTubeVideoId } from '../utils/youtube'

/**
 * Resolve the dropdown thumbnail src for a history entry, or null to fall
 * back to the type icon.
 */
export function resolveHistoryThumbnailSrc(
  entry: UrlHistoryEntry,
  imageObjectUrls: Map<string, string>,
): string | null {
  if (entry.type === 'image') return imageObjectUrls.get(entry.url) ?? null
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url)
    return id ? buildYouTubeThumbnailUrl(id) : null
  }
  if (entry.type === 'pexels') return entry.thumbnailUrl ?? null
  return entry.url
}
