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

export function buildYouTubeEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  })
  if (typeof window !== 'undefined' && window.location?.origin) {
    params.set('origin', window.location.origin)
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
}
