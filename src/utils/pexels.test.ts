import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  buildPexelsReferenceInfo,
  getPexelsApiKey,
  getPhoto,
  isAbortError,
  mapPexelsErrorKey,
  parsePexelsPhotoUrl,
  PexelsAuthError,
  PexelsKeyMissingError,
  PexelsNetworkError,
  PexelsRateLimitError,
  searchPhotos,
  setPexelsApiKey,
  type PexelsPhoto,
} from './pexels'

describe('parsePexelsPhotoUrl', () => {
  it('extracts id from /photo/slug-12345/', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/man-jogging-in-park-12345/')).toEqual({ id: 12345 })
  })

  it('extracts id from /photo/12345 without slug', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/12345/')).toEqual({ id: 12345 })
  })

  it('extracts id from locale-prefixed paths', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/ja-jp/photo/some-slug-987654/')).toEqual({ id: 987654 })
    expect(parsePexelsPhotoUrl('https://www.pexels.com/en-us/photo/42/')).toEqual({ id: 42 })
  })

  it('accepts pexels.com without www', () => {
    expect(parsePexelsPhotoUrl('https://pexels.com/photo/foo-1/')).toEqual({ id: 1 })
  })

  it('trims surrounding whitespace', () => {
    expect(parsePexelsPhotoUrl('  https://www.pexels.com/photo/foo-555/  ')).toEqual({ id: 555 })
  })

  it('returns null for non-Pexels URLs', () => {
    expect(parsePexelsPhotoUrl('https://www.example.com/photo/foo-1/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.sketchfab.com/photo/foo-1/')).toBeNull()
  })

  it('returns null for Pexels home/collections pages', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/search/pose/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/collections/abc/')).toBeNull()
  })

  it('returns null when the trailing segment has no numeric id', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/no-numbers/')).toBeNull()
  })

  it('returns null for malformed or empty input', () => {
    expect(parsePexelsPhotoUrl('')).toBeNull()
    expect(parsePexelsPhotoUrl('not a url')).toBeNull()
  })
})

describe('API key management', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('returns empty string when no key is set', () => {
    expect(getPexelsApiKey()).toBe('')
  })

  it('persists key via setPexelsApiKey and reads it back', () => {
    setPexelsApiKey('abc123')
    expect(getPexelsApiKey()).toBe('abc123')
  })

  it('clears the stored key when an empty string is passed', () => {
    setPexelsApiKey('abc123')
    setPexelsApiKey('')
    expect(getPexelsApiKey()).toBe('')
    expect(localStorage.getItem('pexelsApiKey')).toBeNull()
  })
})

describe('buildPexelsReferenceInfo', () => {
  const photoBase: PexelsPhoto = {
    id: 4242,
    width: 1920,
    height: 1280,
    url: 'https://www.pexels.com/photo/sample-4242/',
    photographer: 'Jane Doe',
    photographer_url: 'https://www.pexels.com/@jane',
    photographer_id: 1,
    alt: 'A dynamic pose',
    src: {
      original: 'https://images.pexels.com/photos/4242/orig.jpeg',
      large2x: 'https://images.pexels.com/photos/4242/large2x.jpeg',
      large: '',
      medium: '',
      small: '',
      portrait: '',
      landscape: '',
      tiny: '',
    },
  }

  it('uses photo.alt as the title when present', () => {
    const info = buildPexelsReferenceInfo(photoBase)
    expect(info.title).toBe('A dynamic pose')
    expect(info.author).toBe('Jane Doe')
    expect(info.source).toBe('pexels')
    expect(info.pexelsPhotoId).toBe(4242)
    expect(info.pexelsImageUrl).toBe('https://images.pexels.com/photos/4242/large2x.jpeg')
    expect(info.pexelsPhotographerUrl).toBe('https://www.pexels.com/@jane')
    expect(info.pexelsPageUrl).toBe('https://www.pexels.com/photo/sample-4242/')
  })

  it('falls back to "Photo #<id>" when alt is empty', () => {
    const info = buildPexelsReferenceInfo({ ...photoBase, alt: '' })
    expect(info.title).toBe('Photo #4242')
  })

  it('falls back to "Photo #<id>" when alt is whitespace-only', () => {
    const info = buildPexelsReferenceInfo({ ...photoBase, alt: '   \t  ' })
    expect(info.title).toBe('Photo #4242')
  })
})

describe('mapPexelsErrorKey', () => {
  it('maps PexelsKeyMissingError to pexelsKeyRequired', () => {
    expect(mapPexelsErrorKey(new PexelsKeyMissingError())).toBe('pexelsKeyRequired')
  })

  it('maps PexelsAuthError to pexelsKeyInvalid', () => {
    expect(mapPexelsErrorKey(new PexelsAuthError())).toBe('pexelsKeyInvalid')
  })

  it('maps PexelsRateLimitError to pexelsRateLimit', () => {
    expect(mapPexelsErrorKey(new PexelsRateLimitError(1234567890))).toBe('pexelsRateLimit')
  })

  it('maps PexelsNetworkError to pexelsNetworkError', () => {
    expect(mapPexelsErrorKey(new PexelsNetworkError('socket hang up'))).toBe('pexelsNetworkError')
  })

  it('falls back to pexelsNetworkError for unknown error shapes', () => {
    expect(mapPexelsErrorKey(new Error('surprise'))).toBe('pexelsNetworkError')
    expect(mapPexelsErrorKey('string throw')).toBe('pexelsNetworkError')
    expect(mapPexelsErrorKey(undefined)).toBe('pexelsNetworkError')
  })
})

describe('isAbortError', () => {
  it('returns true for DOMException with name="AbortError"', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('returns false for other DOMExceptions', () => {
    expect(isAbortError(new DOMException('not aborted', 'NotFoundError'))).toBe(false)
  })

  it('returns false for plain Errors', () => {
    expect(isAbortError(new Error('oops'))).toBe(false)
  })

  it('returns false for non-error values', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})

describe('searchPhotos / getPhoto (via pexelsFetch)', () => {
  const API_KEY = 'test-api-key'
  let fetchMock: Mock

  beforeEach(() => {
    localStorage.setItem('pexelsApiKey', API_KEY)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, ...init })

  it('throws PexelsKeyMissingError before calling fetch when no key is set', async () => {
    localStorage.clear()
    await expect(searchPhotos({ query: 'pose' })).rejects.toBeInstanceOf(PexelsKeyMissingError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends query / page / per_page and Authorization header to /v1/search', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      photos: [], page: 1, per_page: 24, total_results: 0,
    }))

    await searchPhotos({ query: 'dance pose', page: 2, perPage: 10 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]
    const url = new URL(calledUrl as string)
    expect(url.origin + url.pathname).toBe('https://api.pexels.com/v1/search')
    expect(url.searchParams.get('query')).toBe('dance pose')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('10')
    expect(url.searchParams.has('orientation')).toBe(false)
    expect((calledInit as RequestInit).headers).toEqual({ Authorization: API_KEY })
  })

  it('includes orientation when supplied', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      photos: [], page: 1, per_page: 24, total_results: 0,
    }))

    await searchPhotos({ query: 'pose', orientation: 'portrait' })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('orientation')).toBe('portrait')
  })

  it('defaults page=1 and per_page=24 when not supplied', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      photos: [], page: 1, per_page: 24, total_results: 0,
    }))

    await searchPhotos({ query: 'pose' })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('per_page')).toBe('24')
  })

  it('parses a successful search response', async () => {
    const body = {
      photos: [{ id: 1 }],
      next_page: 'https://api.pexels.com/v1/search?page=2',
      page: 1,
      per_page: 24,
      total_results: 100,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(body))

    const res = await searchPhotos({ query: 'pose' })
    expect(res).toEqual(body)
  })

  it('hits /v1/photos/<id> for getPhoto', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7 }))
    await getPhoto(7)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.pexels.com/v1/photos/7')
  })

  it('throws PexelsAuthError on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(searchPhotos({ query: 'pose' })).rejects.toBeInstanceOf(PexelsAuthError)
  })

  it('throws PexelsAuthError on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(getPhoto(1)).rejects.toBeInstanceOf(PexelsAuthError)
  })

  it('throws PexelsRateLimitError on 429 and exposes the reset timestamp', async () => {
    const resetTs = 1700000000
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'X-Ratelimit-Reset': String(resetTs) } }),
    )

    const err = await searchPhotos({ query: 'pose' }).catch(e => e as unknown)
    expect(err).toBeInstanceOf(PexelsRateLimitError)
    expect((err as PexelsRateLimitError).resetTimestamp).toBe(resetTs)
  })

  it('returns null resetTimestamp on 429 when the header is missing or malformed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
    const missing = await searchPhotos({ query: 'pose' }).catch(e => e as unknown)
    expect(missing).toBeInstanceOf(PexelsRateLimitError)
    expect((missing as PexelsRateLimitError).resetTimestamp).toBeNull()

    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'X-Ratelimit-Reset': 'not-a-number' } }),
    )
    const malformed = await searchPhotos({ query: 'pose' }).catch(e => e as unknown)
    expect((malformed as PexelsRateLimitError).resetTimestamp).toBeNull()
  })

  it('throws PexelsNetworkError for other non-ok HTTP statuses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(searchPhotos({ query: 'pose' })).rejects.toBeInstanceOf(PexelsNetworkError)
  })

  it('throws PexelsNetworkError when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(searchPhotos({ query: 'pose' })).rejects.toBeInstanceOf(PexelsNetworkError)
  })

  it('propagates AbortError without wrapping it in PexelsNetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))

    const err = await searchPhotos({ query: 'pose' }).catch(e => e as unknown)
    expect(isAbortError(err)).toBe(true)
    expect(err).not.toBeInstanceOf(PexelsNetworkError)
  })

  it('passes the AbortSignal to fetch so callers can cancel requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      photos: [], page: 1, per_page: 24, total_results: 0,
    }))

    const ctrl = new AbortController()
    await searchPhotos({ query: 'pose' }, ctrl.signal)

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(ctrl.signal)
  })
})
