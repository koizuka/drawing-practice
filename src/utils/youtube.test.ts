import { parseYouTubeVideoId, buildYouTubeEmbedUrl } from './youtube'

describe('parseYouTubeVideoId', () => {
  it('extracts id from youtube.com/watch?v=', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from youtube.com/watch with extra params', () => {
    expect(parseYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from youtu.be short URL', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from youtu.be with query', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from m.youtube.com', () => {
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from youtube.com/shorts', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts id from youtube.com/embed', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('accepts ids with hyphens and underscores', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=abc_DEF-123')).toBe('abc_DEF-123')
  })

  it('trims surrounding whitespace', () => {
    expect(parseYouTubeVideoId('  https://youtu.be/dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/image.png')).toBeNull()
    expect(parseYouTubeVideoId('https://vimeo.com/123456')).toBeNull()
  })

  it('returns null when video id is not 11 chars', () => {
    expect(parseYouTubeVideoId('https://youtu.be/short')).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=tooooooolong123')).toBeNull()
  })

  it('returns null when v param is missing', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch')).toBeNull()
  })

  it('returns null for invalid URL strings', () => {
    expect(parseYouTubeVideoId('')).toBeNull()
    expect(parseYouTubeVideoId('not a url')).toBeNull()
  })
})

describe('buildYouTubeEmbedUrl', () => {
  it('generates embed URL with playsinline param', () => {
    const url = buildYouTubeEmbedUrl('dQw4w9WgXcQ')
    expect(url).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ?')
    expect(url).toContain('playsinline=1')
    expect(url).toContain('rel=0')
    expect(url).toContain('modestbranding=1')
  })
})
