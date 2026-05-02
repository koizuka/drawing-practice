import { vi, afterEach } from 'vitest';
import { parseYouTubeVideoId, buildYouTubeEmbedUrl, fetchYouTubeTitle } from './youtube';

describe('parseYouTubeVideoId', () => {
  it('extracts id from youtube.com/watch?v=', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtube.com/watch with extra params', () => {
    expect(parseYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtu.be short URL', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtu.be with query', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from m.youtube.com', () => {
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtube.com/shorts', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtube.com/embed', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('accepts ids with hyphens and underscores', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=abc_DEF-123')).toBe('abc_DEF-123');
  });

  it('trims surrounding whitespace', () => {
    expect(parseYouTubeVideoId('  https://youtu.be/dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/image.png')).toBeNull();
    expect(parseYouTubeVideoId('https://vimeo.com/123456')).toBeNull();
  });

  it('returns null when video id is not 11 chars', () => {
    expect(parseYouTubeVideoId('https://youtu.be/short')).toBeNull();
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=tooooooolong123')).toBeNull();
  });

  it('returns null when v param is missing', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch')).toBeNull();
  });

  it('returns null for invalid URL strings', () => {
    expect(parseYouTubeVideoId('')).toBeNull();
    expect(parseYouTubeVideoId('not a url')).toBeNull();
  });
});

describe('buildYouTubeEmbedUrl', () => {
  it('generates embed URL with playsinline param', () => {
    const url = buildYouTubeEmbedUrl('dQw4w9WgXcQ');
    expect(url).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ?');
    expect(url).toContain('playsinline=1');
    expect(url).toContain('rel=0');
    expect(url).toContain('modestbranding=1');
  });

  it('includes enablejsapi so postMessage commands work', () => {
    const url = buildYouTubeEmbedUrl('dQw4w9WgXcQ');
    expect(url).toContain('enablejsapi=1');
  });
});

describe('fetchYouTubeTitle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the title from oEmbed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Never Gonna Give You Up' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const title = await fetchYouTubeTitle('dQw4w9WgXcQ');
    expect(title).toBe('Never Gonna Give You Up');
    const calledWith = fetchMock.mock.calls[0][0] as string;
    expect(calledWith).toContain('youtube.com/oembed');
    expect(calledWith).toContain(encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  });

  it('trims the returned title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: '  Spaced Title  ' }),
    }));
    expect(await fetchYouTubeTitle('dQw4w9WgXcQ')).toBe('Spaced Title');
  });

  it('returns null on non-ok response (private/removed video)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchYouTubeTitle('dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchYouTubeTitle('dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null when title is missing or empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: '   ' }),
    }));
    expect(await fetchYouTubeTitle('dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null for an invalid video id without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchYouTubeTitle('not-11-chars')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
