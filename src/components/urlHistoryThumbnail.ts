import type { UrlHistoryEntry } from '../storage/db';
import { buildYouTubeThumbnailUrl, parseYouTubeVideoId } from '../utils/youtube';

/**
 * Resolve the dropdown thumbnail src for a history entry, or null to fall
 * back to the type icon.
 */
export function resolveHistoryThumbnailSrc(
  entry: UrlHistoryEntry,
  imageObjectUrls: Map<string, string>,
): string | null {
  if (entry.type === 'image') return imageObjectUrls.get(entry.url) ?? null;
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url);
    return id ? buildYouTubeThumbnailUrl(id) : null;
  }
  if (entry.type === 'pexels') return entry.thumbnailUrl ?? null;
  if (entry.type === 'sketchfab') {
    // Prefer the Blob ObjectURL (the full Fix-Angle screenshot) so the
    // dropdown reflects the exact angle the user fixed; fall back to the
    // model CDN thumbnail when no screenshot exists yet.
    return imageObjectUrls.get(entry.url) ?? entry.thumbnailUrl ?? null;
  }
  return entry.url;
}
