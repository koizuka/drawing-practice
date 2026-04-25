export const YOUTUBE_ORIGIN = 'https://www.youtube.com'

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

function isValidVideoId(id: string | null | undefined): id is string {
  return typeof id === 'string' && VIDEO_ID_PATTERN.test(id)
}

export function parseYouTubeVideoId(rawUrl: string): string | null {
  if (!rawUrl) return null

  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return isValidVideoId(id) ? id : null
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v')
      return isValidVideoId(id) ? id : null
    }
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length >= 2 && (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live')) {
      const id = segments[1]
      return isValidVideoId(id) ? id : null
    }
  }

  return null
}

/**
 * Canonical watch-page URL used as the URL-history dedup key. All surface
 * forms of the same video (`youtu.be/X`, `youtube.com/watch?v=X`, `...&t=30s`)
 * collapse onto this single key.
 */
export function buildYouTubeCanonicalUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`
}

/**
 * Default-quality thumbnail URL (120x90, JPEG). Used by the URL-history
 * dropdown preview — derived at render time so we don't need to persist a
 * thumbnailUrl for YouTube history entries.
 */
export function buildYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/default.jpg`
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    // Required for the IFrame Player API to accept postMessage commands
    // (playVideo / pauseVideo) and to emit state-change events back.
    enablejsapi: '1',
  })
  if (typeof window !== 'undefined' && window.location?.origin) {
    params.set('origin', window.location.origin)
  }
  return `${YOUTUBE_ORIGIN}/embed/${videoId}?${params.toString()}`
}

/**
 * Fetch the video title via YouTube's public oEmbed endpoint. Returns null
 * when the video is private/removed/age-gated, or when the network fails.
 * The endpoint sets `Access-Control-Allow-Origin: *`, so this works from the
 * browser without a proxy.
 */
export async function fetchYouTubeTitle(videoId: string, signal?: AbortSignal): Promise<string | null> {
  if (!isValidVideoId(videoId)) return null
  const target = `${YOUTUBE_ORIGIN}/watch?v=${videoId}`
  const oembedUrl = `${YOUTUBE_ORIGIN}/oembed?url=${encodeURIComponent(target)}&format=json`
  try {
    const res = await fetch(oembedUrl, { signal })
    if (!res.ok) return null
    const data = await res.json() as { title?: unknown }
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null
  } catch {
    return null
  }
}
