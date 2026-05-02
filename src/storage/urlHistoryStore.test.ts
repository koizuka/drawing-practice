import { vi, type Mock } from 'vitest';
import type { UrlHistoryEntry } from './db';

const { orderedToArrayFn } = vi.hoisted(() => ({
  orderedToArrayFn: vi.fn().mockResolvedValue([]),
}));

vi.mock('./db', () => ({
  db: {
    urlHistory: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      toArray: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn(() => ({ reverse: () => ({ toArray: orderedToArrayFn }) })),
    },
  },
}));

import { addUrlHistory, getUrlHistory, deleteUrlHistory, URL_HISTORY_LIMIT, URL_HISTORY_IMAGE_LIMIT } from './urlHistoryStore';
import { db } from './db';

const mockToArray = () => db.urlHistory.toArray as Mock;
const mockPut = () => db.urlHistory.put as Mock;
const mockGet = () => db.urlHistory.get as Mock;
const mockBulkDelete = () => db.urlHistory.bulkDelete as Mock;
const mockDelete = () => db.urlHistory.delete as Mock;
const mockOrderBy = () => db.urlHistory.orderBy as Mock;

describe('urlHistoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToArray().mockResolvedValue([]);
    mockGet().mockResolvedValue(undefined);
    orderedToArrayFn.mockResolvedValue([]);
  });

  describe('addUrlHistory', () => {
    it('puts an entry with current timestamp', async () => {
      const before = Date.now();
      await addUrlHistory('https://example.com/a.jpg', 'url');
      const after = Date.now();

      expect(mockPut()).toHaveBeenCalledTimes(1);
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.url).toBe('https://example.com/a.jpg');
      expect(arg.type).toBe('url');
      expect(arg.lastUsedAt).toBeInstanceOf(Date);
      expect(arg.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(arg.lastUsedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('uses put so duplicate URL upserts without adding a second row', async () => {
      // Dexie's put is an upsert keyed by the primary key. Verify we call put
      // (not add) so a re-loaded URL simply refreshes its lastUsedAt.
      await addUrlHistory('https://example.com/a.jpg', 'url');
      await addUrlHistory('https://example.com/a.jpg', 'url');
      expect(mockPut()).toHaveBeenCalledTimes(2);
    });

    it('does not prune when count is at or below the limit', async () => {
      const entries: UrlHistoryEntry[] = Array.from({ length: URL_HISTORY_LIMIT }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(1000 + i),
      }));
      mockToArray().mockResolvedValue(entries);

      await addUrlHistory('https://example.com/new', 'url');

      expect(mockBulkDelete()).not.toHaveBeenCalled();
    });

    it('stores the title when provided', async () => {
      await addUrlHistory('https://youtu.be/abc', 'youtube', '  Great Video  ');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBe('Great Video');
    });

    it('preserves an existing title when called again without a title', async () => {
      mockGet().mockResolvedValueOnce({
        url: 'https://youtu.be/abc',
        type: 'youtube',
        title: 'Cached Title',
        lastUsedAt: new Date(1000),
      });
      await addUrlHistory('https://youtu.be/abc', 'youtube');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBe('Cached Title');
    });

    it('overwrites the title when a new title is provided', async () => {
      // No need to mock `get` — when a title is passed in, the store should
      // skip the existing-title lookup entirely.
      await addUrlHistory('https://youtu.be/abc', 'youtube', 'New Title');
      expect(mockGet()).not.toHaveBeenCalled();
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBe('New Title');
    });

    it('omits title when none is provided and none exists', async () => {
      mockGet().mockResolvedValueOnce(undefined);
      await addUrlHistory('https://example.com/a.jpg', 'url');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBeUndefined();
    });

    it('canonicalizes YouTube URLs to https://youtu.be/<id> before storing', async () => {
      await addUrlHistory('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'youtube');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.url).toBe('https://youtu.be/dQw4w9WgXcQ');
    });

    it('looks up existing YouTube entries by canonical key so titles survive across surface variants', async () => {
      mockGet().mockResolvedValueOnce({
        url: 'https://youtu.be/dQw4w9WgXcQ',
        type: 'youtube',
        title: 'Cached Title',
        lastUsedAt: new Date(1000),
      });
      // Different surface form, same video — should hit the cached entry.
      await addUrlHistory('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube');
      expect(mockGet()).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.url).toBe('https://youtu.be/dQw4w9WgXcQ');
      expect(arg.title).toBe('Cached Title');
    });

    it('does not canonicalize non-YouTube URLs', async () => {
      await addUrlHistory('https://www.pexels.com/photo/whatever-12345/', 'pexels', 'shot');
      await addUrlHistory('https://example.com/a.jpg?v=2', 'url');
      const pexelsArg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      const urlArg = mockPut().mock.calls[1][0] as UrlHistoryEntry;
      expect(pexelsArg.url).toBe('https://www.pexels.com/photo/whatever-12345/');
      expect(urlArg.url).toBe('https://example.com/a.jpg?v=2');
    });

    it('leaves a YouTube URL untouched when the video ID cannot be parsed', async () => {
      // Not a valid YouTube watch URL — falls back to using the input as-is so
      // the user still sees their entry rather than silently losing it.
      await addUrlHistory('https://www.youtube.com/results?search_query=foo', 'youtube');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.url).toBe('https://www.youtube.com/results?search_query=foo');
    });

    it('deletes the oldest entries when count exceeds the limit', async () => {
      const overLimit = URL_HISTORY_LIMIT + 3;
      const entries: UrlHistoryEntry[] = Array.from({ length: overLimit }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(1000 + i), // i=0 is oldest
      }));
      mockToArray().mockResolvedValue(entries);

      await addUrlHistory('https://example.com/new', 'url');

      expect(mockBulkDelete()).toHaveBeenCalledTimes(1);
      const deletedUrls = mockBulkDelete().mock.calls[0][0] as string[];
      expect(deletedUrls).toHaveLength(3);
      expect(deletedUrls).toEqual([
        'https://example.com/0',
        'https://example.com/1',
        'https://example.com/2',
      ]);
    });

    it('stores an image entry with fileName and imageBlob', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      await addUrlHistory('local:abc123', 'image', { fileName: 'cat.jpg', imageBlob: blob });
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.url).toBe('local:abc123');
      expect(arg.type).toBe('image');
      expect(arg.fileName).toBe('cat.jpg');
      expect(arg.imageBlob).toBe(blob);
    });

    it('preserves existing imageBlob and fileName when re-upserted without them (bump lastUsedAt only)', async () => {
      const existingBlob = new Blob(['old']);
      mockGet().mockResolvedValueOnce({
        url: 'local:abc123',
        type: 'image',
        fileName: 'cat.jpg',
        imageBlob: existingBlob,
        lastUsedAt: new Date(1000),
      });
      await addUrlHistory('local:abc123', 'image', { fileName: 'cat-renamed.jpg' });
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      // new fileName wins; Blob is preserved from existing
      expect(arg.fileName).toBe('cat-renamed.jpg');
      expect(arg.imageBlob).toBe(existingBlob);
    });

    it('still accepts the legacy string title form (backward compat)', async () => {
      await addUrlHistory('https://example.com/a.jpg', 'url', 'Old-style title');
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBe('Old-style title');
      expect(arg.fileName).toBeUndefined();
      expect(arg.imageBlob).toBeUndefined();
    });

    it('stores a pexels entry with thumbnailUrl', async () => {
      await addUrlHistory('https://www.pexels.com/photo/whatever-123/', 'pexels', {
        title: 'A photo',
        thumbnailUrl: 'https://images.pexels.com/photos/123/x?auto=compress&cs=tinysrgb&h=130',
      });
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.type).toBe('pexels');
      expect(arg.thumbnailUrl).toBe('https://images.pexels.com/photos/123/x?auto=compress&cs=tinysrgb&h=130');
      expect(arg.title).toBe('A photo');
    });

    it('preserves an existing thumbnailUrl when re-upserted without one (pexels)', async () => {
      mockGet().mockResolvedValueOnce({
        url: 'https://www.pexels.com/photo/whatever-123/',
        type: 'pexels',
        title: 'Old title',
        thumbnailUrl: 'https://images.pexels.com/photos/123/cached-tiny.jpg',
        lastUsedAt: new Date(1000),
      });
      // Title is provided so the title-fallback path isn't what triggers the
      // lookup — this verifies the thumbnailUrl-specific lookup branch.
      await addUrlHistory('https://www.pexels.com/photo/whatever-123/', 'pexels', {
        title: 'New title',
      });
      expect(mockGet()).toHaveBeenCalledTimes(1);
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.title).toBe('New title');
      expect(arg.thumbnailUrl).toBe('https://images.pexels.com/photos/123/cached-tiny.jpg');
    });

    it('skips the existing-entry lookup for non-pexels types when title is supplied', async () => {
      // Title is the only field worth preserving for url/youtube entries — the
      // dropdown derives their thumbnails at render time, so we must not pay a
      // DB read just to refresh lastUsedAt.
      await addUrlHistory('https://example.com/a.jpg', 'url', { title: 'Hello' });
      expect(mockGet()).not.toHaveBeenCalled();
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.thumbnailUrl).toBeUndefined();
    });

    it('applies the image cap independently from the URL/YouTube cap', async () => {
      // URLs at their limit, images one over → only the oldest image is evicted;
      // URL entries are untouched.
      const urls: UrlHistoryEntry[] = Array.from({ length: URL_HISTORY_LIMIT }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(10_000 + i),
      }));
      const images: UrlHistoryEntry[] = Array.from({ length: URL_HISTORY_IMAGE_LIMIT + 1 }, (_, i) => ({
        url: `local:${i}`,
        type: 'image',
        fileName: `img${i}.jpg`,
        imageBlob: new Blob(['x']),
        lastUsedAt: new Date(1000 + i), // i=0 is oldest image
      }));
      mockToArray().mockResolvedValue([...urls, ...images]);

      await addUrlHistory('local:new', 'image', { fileName: 'new.jpg', imageBlob: new Blob(['new']) });

      expect(mockBulkDelete()).toHaveBeenCalledTimes(1);
      const deletedUrls = mockBulkDelete().mock.calls[0][0] as string[];
      expect(deletedUrls).toEqual(['local:0']);
    });

    it('re-upsert of an image bumps lastUsedAt strictly greater than the latest peer', async () => {
      // Existing test at "preserves existing imageBlob..." only asserts the field
      // is preserved; this one nails down the LRU contract — the bumped timestamp
      // must outrank every existing peer so the entry can survive the next eviction.
      const peerLatest = 1009;
      mockGet().mockResolvedValueOnce({
        url: 'local:0',
        type: 'image',
        fileName: 'img0.jpg',
        imageBlob: new Blob(['x']),
        lastUsedAt: new Date(1000),
      });
      await addUrlHistory('local:0', 'image', { fileName: 'img0.jpg' });
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry;
      expect(arg.lastUsedAt.getTime()).toBeGreaterThan(peerLatest);
    });

    it('LRU: a recently re-touched image survives the next eviction', async () => {
      // Round-trip scenario: re-touching an existing image must shift which entry
      // counts as "oldest" so a subsequent over-cap add evicts a different row.
      const buildImages = (overrides: Record<string, number> = {}): UrlHistoryEntry[] =>
        Array.from({ length: URL_HISTORY_IMAGE_LIMIT }, (_, i) => ({
          url: `local:${i}`,
          type: 'image',
          fileName: `img${i}.jpg`,
          imageBlob: new Blob(['x']),
          lastUsedAt: new Date(overrides[`local:${i}`] ?? 1000 + i),
        }));

      mockGet().mockResolvedValueOnce({
        url: 'local:0',
        type: 'image',
        fileName: 'img0.jpg',
        imageBlob: new Blob(['x']),
        lastUsedAt: new Date(1000),
      });
      mockToArray().mockResolvedValueOnce(buildImages());
      await addUrlHistory('local:0', 'image', { fileName: 'img0.jpg' });
      const bumpedTs = (mockPut().mock.calls[0][0] as UrlHistoryEntry).lastUsedAt.getTime();
      expect(mockBulkDelete()).not.toHaveBeenCalled();

      // Mock the post-put state: 10 originals (with local:0 bumped) + the new
      // entry, putting us at 11 → eviction must drop exactly one.
      mockToArray().mockResolvedValueOnce([
        ...buildImages({ 'local:0': bumpedTs }),
        {
          url: 'local:new',
          type: 'image',
          fileName: 'new.jpg',
          imageBlob: new Blob(['new']),
          lastUsedAt: new Date(bumpedTs + 100),
        },
      ]);
      await addUrlHistory('local:new', 'image', { fileName: 'new.jpg', imageBlob: new Blob(['new']) });

      expect(mockBulkDelete()).toHaveBeenCalledTimes(1);
      expect(mockBulkDelete().mock.calls[0][0]).toEqual(['local:1']);
    });

    it('image history does not evict URL/YouTube entries when only the URL side is at its limit', async () => {
      // URLs at exactly their limit, no images at all yet — adding a new image
      // must not prune any URL entry.
      const urls: UrlHistoryEntry[] = Array.from({ length: URL_HISTORY_LIMIT }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(1000 + i),
      }));
      mockToArray().mockResolvedValue(urls);

      await addUrlHistory('local:only', 'image', { fileName: 'x.jpg', imageBlob: new Blob(['x']) });

      expect(mockBulkDelete()).not.toHaveBeenCalled();
    });
  });

  describe('getUrlHistory', () => {
    it('queries the lastUsedAt index in reverse order', async () => {
      const entries: UrlHistoryEntry[] = [
        { url: 'newest', type: 'youtube', lastUsedAt: new Date(3000) },
        { url: 'mid', type: 'pexels', lastUsedAt: new Date(2000) },
        { url: 'old', type: 'url', lastUsedAt: new Date(1000) },
      ];
      orderedToArrayFn.mockResolvedValueOnce(entries);

      const result = await getUrlHistory();
      expect(mockOrderBy()).toHaveBeenCalledWith('lastUsedAt');
      expect(result).toEqual(entries);
    });

    it('returns an empty array when there is no history', async () => {
      expect(await getUrlHistory()).toEqual([]);
    });
  });

  describe('deleteUrlHistory', () => {
    it('deletes the entry by url key', async () => {
      await deleteUrlHistory('https://example.com/a.jpg');
      expect(mockDelete()).toHaveBeenCalledWith('https://example.com/a.jpg');
    });
  });
});
