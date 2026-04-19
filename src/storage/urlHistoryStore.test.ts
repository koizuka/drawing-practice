import { vi, type Mock } from 'vitest'
import type { UrlHistoryEntry } from './db'

const { orderedToArrayFn } = vi.hoisted(() => ({
  orderedToArrayFn: vi.fn().mockResolvedValue([]),
}))

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
}))

import { addUrlHistory, getUrlHistory, deleteUrlHistory, URL_HISTORY_LIMIT } from './urlHistoryStore'
import { db } from './db'

const mockToArray = () => db.urlHistory.toArray as Mock
const mockPut = () => db.urlHistory.put as Mock
const mockGet = () => db.urlHistory.get as Mock
const mockBulkDelete = () => db.urlHistory.bulkDelete as Mock
const mockDelete = () => db.urlHistory.delete as Mock
const mockOrderBy = () => db.urlHistory.orderBy as Mock

describe('urlHistoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToArray().mockResolvedValue([])
    mockGet().mockResolvedValue(undefined)
    orderedToArrayFn.mockResolvedValue([])
  })

  describe('addUrlHistory', () => {
    it('puts an entry with current timestamp', async () => {
      const before = Date.now()
      await addUrlHistory('https://example.com/a.jpg', 'url')
      const after = Date.now()

      expect(mockPut()).toHaveBeenCalledTimes(1)
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry
      expect(arg.url).toBe('https://example.com/a.jpg')
      expect(arg.type).toBe('url')
      expect(arg.lastUsedAt).toBeInstanceOf(Date)
      expect(arg.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(arg.lastUsedAt.getTime()).toBeLessThanOrEqual(after)
    })

    it('uses put so duplicate URL upserts without adding a second row', async () => {
      // Dexie's put is an upsert keyed by the primary key. Verify we call put
      // (not add) so a re-loaded URL simply refreshes its lastUsedAt.
      await addUrlHistory('https://example.com/a.jpg', 'url')
      await addUrlHistory('https://example.com/a.jpg', 'url')
      expect(mockPut()).toHaveBeenCalledTimes(2)
    })

    it('does not prune when count is at or below the limit', async () => {
      const entries: UrlHistoryEntry[] = Array.from({ length: URL_HISTORY_LIMIT }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(1000 + i),
      }))
      mockToArray().mockResolvedValue(entries)

      await addUrlHistory('https://example.com/new', 'url')

      expect(mockBulkDelete()).not.toHaveBeenCalled()
    })

    it('stores the title when provided', async () => {
      await addUrlHistory('https://youtu.be/abc', 'youtube', '  Great Video  ')
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry
      expect(arg.title).toBe('Great Video')
    })

    it('preserves an existing title when called again without a title', async () => {
      mockGet().mockResolvedValueOnce({
        url: 'https://youtu.be/abc',
        type: 'youtube',
        title: 'Cached Title',
        lastUsedAt: new Date(1000),
      })
      await addUrlHistory('https://youtu.be/abc', 'youtube')
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry
      expect(arg.title).toBe('Cached Title')
    })

    it('overwrites the title when a new title is provided', async () => {
      // No need to mock `get` — when a title is passed in, the store should
      // skip the existing-title lookup entirely.
      await addUrlHistory('https://youtu.be/abc', 'youtube', 'New Title')
      expect(mockGet()).not.toHaveBeenCalled()
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry
      expect(arg.title).toBe('New Title')
    })

    it('omits title when none is provided and none exists', async () => {
      mockGet().mockResolvedValueOnce(undefined)
      await addUrlHistory('https://example.com/a.jpg', 'url')
      const arg = mockPut().mock.calls[0][0] as UrlHistoryEntry
      expect(arg.title).toBeUndefined()
    })

    it('deletes the oldest entries when count exceeds the limit', async () => {
      const overLimit = URL_HISTORY_LIMIT + 3
      const entries: UrlHistoryEntry[] = Array.from({ length: overLimit }, (_, i) => ({
        url: `https://example.com/${i}`,
        type: 'url',
        lastUsedAt: new Date(1000 + i),  // i=0 is oldest
      }))
      mockToArray().mockResolvedValue(entries)

      await addUrlHistory('https://example.com/new', 'url')

      expect(mockBulkDelete()).toHaveBeenCalledTimes(1)
      const deletedUrls = mockBulkDelete().mock.calls[0][0] as string[]
      expect(deletedUrls).toHaveLength(3)
      expect(deletedUrls).toEqual([
        'https://example.com/0',
        'https://example.com/1',
        'https://example.com/2',
      ])
    })
  })

  describe('getUrlHistory', () => {
    it('queries the lastUsedAt index in reverse order', async () => {
      const entries: UrlHistoryEntry[] = [
        { url: 'newest', type: 'youtube', lastUsedAt: new Date(3000) },
        { url: 'mid', type: 'pexels', lastUsedAt: new Date(2000) },
        { url: 'old', type: 'url', lastUsedAt: new Date(1000) },
      ]
      orderedToArrayFn.mockResolvedValueOnce(entries)

      const result = await getUrlHistory()
      expect(mockOrderBy()).toHaveBeenCalledWith('lastUsedAt')
      expect(result).toEqual(entries)
    })

    it('returns an empty array when there is no history', async () => {
      expect(await getUrlHistory()).toEqual([])
    })
  })

  describe('deleteUrlHistory', () => {
    it('deletes the entry by url key', async () => {
      await deleteUrlHistory('https://example.com/a.jpg')
      expect(mockDelete()).toHaveBeenCalledWith('https://example.com/a.jpg')
    })
  })
})
