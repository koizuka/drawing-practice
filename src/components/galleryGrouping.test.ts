import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DrawingRecord } from '../storage'
import type { ReferenceInfo } from '../types'
import { buildYouTubeGalleryThumbnailUrl } from '../utils/youtube'
import {
  buildGroups,
  canLoadReference,
  GROUP_MODE_STORAGE_KEY,
  LEGACY_GROUP_KEY,
  loadGroupMode,
  persistGroupMode,
  refLabelOf,
  syncThumbUrl,
} from './galleryGrouping'

const LEGACY_LABEL = 'Other'

let nextId = 1
function makeDrawing(createdAt: string, reference?: ReferenceInfo, referenceInfoString = ''): DrawingRecord {
  return {
    id: nextId++,
    strokes: [],
    thumbnail: '',
    referenceInfo: referenceInfoString,
    reference,
    createdAt: new Date(createdAt),
    elapsedMs: 0,
  }
}

const sketchfabRef: ReferenceInfo = {
  source: 'sketchfab',
  sketchfabUid: 'abc',
  title: 'Cat',
  author: 'Alice',
}
const youtubeRef: ReferenceInfo = {
  source: 'youtube',
  youtubeVideoId: 'dQw4w9WgXcQ',
  title: 'Pose Reference',
  author: 'Bob',
}
const imageRef: ReferenceInfo = {
  source: 'image',
  fileName: 'cat.jpg',
  url: 'local:abc',
  title: 'cat.jpg',
  author: '',
}
const urlRef: ReferenceInfo = {
  source: 'url',
  imageUrl: 'https://example.com/x.png',
  title: 'X',
  author: '',
}
const pexelsRef: ReferenceInfo = {
  source: 'pexels',
  pexelsPhotoId: 12345,
  pexelsImageUrl: 'https://images.pexels.com/photos/12345/large.jpg',
  title: 'P',
  author: 'Photog',
}

describe('canLoadReference', () => {
  it('returns false for undefined', () => {
    expect(canLoadReference(undefined)).toBe(false)
  })
  it('returns true for sketchfab with uid', () => {
    expect(canLoadReference(sketchfabRef)).toBe(true)
  })
  it('returns true for url with imageUrl', () => {
    expect(canLoadReference(urlRef)).toBe(true)
  })
  it('returns true for youtube with videoId', () => {
    expect(canLoadReference(youtubeRef)).toBe(true)
  })
  it('returns true for pexels with imageUrl', () => {
    expect(canLoadReference(pexelsRef)).toBe(true)
  })
  it('returns true for image with history url', () => {
    expect(canLoadReference(imageRef)).toBe(true)
  })
  it('returns false for image without history url', () => {
    const ref: ReferenceInfo = { source: 'image', fileName: 'cat.jpg', title: '', author: '' }
    expect(canLoadReference(ref)).toBe(false)
  })
})

describe('syncThumbUrl', () => {
  it('returns sketchfab imageUrl when present', () => {
    expect(syncThumbUrl({ ...sketchfabRef, imageUrl: 'data:foo' })).toBe('data:foo')
  })
  it('returns null for sketchfab without imageUrl', () => {
    expect(syncThumbUrl(sketchfabRef)).toBeNull()
  })
  it('returns url imageUrl', () => {
    expect(syncThumbUrl(urlRef)).toBe('https://example.com/x.png')
  })
  it('derives youtube gallery thumbnail (mqdefault) from video id', () => {
    expect(syncThumbUrl(youtubeRef)).toBe(buildYouTubeGalleryThumbnailUrl('dQw4w9WgXcQ'))
  })
  it('returns pexels imageUrl', () => {
    expect(syncThumbUrl(pexelsRef)).toBe(pexelsRef.pexelsImageUrl)
  })
  it('returns null for image (resolved async via urlHistory)', () => {
    expect(syncThumbUrl(imageRef)).toBeNull()
  })
})

describe('refLabelOf', () => {
  it('joins title and author with " - "', () => {
    expect(refLabelOf(sketchfabRef, 'fb')).toBe('Cat - Alice')
  })
  it('uses only title when author is empty', () => {
    expect(refLabelOf({ ...sketchfabRef, author: '' }, 'fb')).toBe('Cat')
  })
  it('falls back when ref is undefined', () => {
    expect(refLabelOf(undefined, 'fb')).toBe('fb')
  })
  it('falls back when joined label is empty', () => {
    expect(refLabelOf({ ...sketchfabRef, title: '', author: '' }, 'fb')).toBe('fb')
  })
})

describe('buildGroups', () => {
  beforeEach(() => { nextId = 1 })

  it('returns [] for empty input', () => {
    expect(buildGroups([], 'date', LEGACY_LABEL)).toEqual([])
    expect(buildGroups([], 'ref-first', LEGACY_LABEL)).toEqual([])
  })

  describe('date mode', () => {
    it('buckets by year-month and orders newest-first across and within groups', () => {
      const drawings = [
        makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),  // 2026-04
        makeDrawing('2026-04-02T10:00:00Z', sketchfabRef),  // 2026-04
        makeDrawing('2026-03-20T10:00:00Z', youtubeRef),    // 2026-03
        makeDrawing('2025-12-31T10:00:00Z', urlRef),        // 2025-12
      ]
      const groups = buildGroups(drawings, 'date', LEGACY_LABEL)

      expect(groups.map(g => g.key)).toEqual(['2026-04', '2026-03', '2025-12'])
      expect(groups[0].drawings.map(d => d.id)).toEqual([1, 2])
      expect(groups[1].drawings.map(d => d.id)).toEqual([3])
      expect(groups[2].drawings.map(d => d.id)).toEqual([4])
    })

    it('does not depend on input order', () => {
      const a = makeDrawing('2026-04-01T00:00:00Z', sketchfabRef)
      const b = makeDrawing('2025-01-15T00:00:00Z', sketchfabRef)
      const c = makeDrawing('2026-04-30T23:59:59Z', sketchfabRef)
      const groups = buildGroups([b, c, a], 'date', LEGACY_LABEL)
      expect(groups.map(g => g.key)).toEqual(['2026-04', '2025-01'])
      expect(groups[0].drawings.map(d => d.id)).toEqual([c.id, a.id])
    })
  })

  describe('ref-first mode', () => {
    it('buckets by referenceKey and orders by oldest first-use', () => {
      // sketchfab first used 2026-01, last 2026-04 → "older first-use"
      // youtube first used 2026-03 → "newer first-use"
      const drawings = [
        makeDrawing('2026-04-10T00:00:00Z', sketchfabRef),
        makeDrawing('2026-01-05T00:00:00Z', sketchfabRef),
        makeDrawing('2026-03-20T00:00:00Z', youtubeRef),
      ]
      const groups = buildGroups(drawings, 'ref-first', LEGACY_LABEL)

      // ref-first: descending by firstUsedAt → youtube (2026-03) before sketchfab (2026-01)
      expect(groups.map(g => g.reference?.source)).toEqual(['youtube', 'sketchfab'])
      expect(groups[1].firstUsedAt.toISOString()).toBe('2026-01-05T00:00:00.000Z')
      expect(groups[1].lastUsedAt.toISOString()).toBe('2026-04-10T00:00:00.000Z')
      // Drawings inside a group are still newest-first
      expect(groups[1].drawings.map(d => d.id)).toEqual([1, 2])
    })

    it('keeps all drawings of the same referenceKey together', () => {
      const drawings = [
        makeDrawing('2026-04-10T00:00:00Z', sketchfabRef),
        makeDrawing('2026-03-10T00:00:00Z', youtubeRef),
        makeDrawing('2026-02-10T00:00:00Z', sketchfabRef),
      ]
      const groups = buildGroups(drawings, 'ref-first', LEGACY_LABEL)
      expect(groups).toHaveLength(2)
      const sketchfabGroup = groups.find(g => g.reference?.source === 'sketchfab')!
      expect(sketchfabGroup.drawings.map(d => d.id)).toEqual([1, 3])
    })

    it('treats different sketchfab uids as different groups', () => {
      const refA: ReferenceInfo = { ...sketchfabRef, sketchfabUid: 'a' }
      const refB: ReferenceInfo = { ...sketchfabRef, sketchfabUid: 'b' }
      const groups = buildGroups([
        makeDrawing('2026-04-10T00:00:00Z', refA),
        makeDrawing('2026-04-10T00:00:00Z', refB),
      ], 'ref-first', LEGACY_LABEL)
      expect(groups).toHaveLength(2)
    })
  })

  describe('ref-recent mode', () => {
    it('orders by descending most-recent-use', () => {
      const drawings = [
        makeDrawing('2026-01-05T00:00:00Z', sketchfabRef),  // sketchfab most-recent: 2026-04
        makeDrawing('2026-04-10T00:00:00Z', sketchfabRef),
        makeDrawing('2026-03-20T00:00:00Z', youtubeRef),    // youtube most-recent: 2026-03
      ]
      const groups = buildGroups(drawings, 'ref-recent', LEGACY_LABEL)
      expect(groups.map(g => g.reference?.source)).toEqual(['sketchfab', 'youtube'])
    })
  })

  describe('legacy bucket', () => {
    it('groups all drawings without reference into a single LEGACY_GROUP_KEY bucket', () => {
      const drawings = [
        makeDrawing('2026-04-10T00:00:00Z', undefined, 'old reference text'),
        makeDrawing('2026-03-10T00:00:00Z', undefined, 'something else'),
        makeDrawing('2026-02-10T00:00:00Z', sketchfabRef),
      ]
      const groups = buildGroups(drawings, 'ref-first', LEGACY_LABEL)
      const legacy = groups.find(g => g.key === LEGACY_GROUP_KEY)
      expect(legacy).toBeDefined()
      expect(legacy!.drawings).toHaveLength(2)
      expect(legacy!.label).toBe(LEGACY_LABEL)
      expect(legacy!.reference).toBeUndefined()
    })

    it('does not affect date mode (legacy drawings still bucket by year-month)', () => {
      const drawings = [
        makeDrawing('2026-04-10T00:00:00Z', undefined, 'a'),
        makeDrawing('2026-03-10T00:00:00Z', undefined, 'b'),
      ]
      const groups = buildGroups(drawings, 'date', LEGACY_LABEL)
      expect(groups).toHaveLength(2)
      expect(groups.every(g => g.key !== LEGACY_GROUP_KEY)).toBe(true)
    })
  })
})

describe('GroupMode persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loadGroupMode defaults to "date" when nothing is stored', () => {
    expect(loadGroupMode()).toBe('date')
  })

  it('round-trips a valid mode through localStorage', () => {
    persistGroupMode('ref-first')
    expect(localStorage.getItem(GROUP_MODE_STORAGE_KEY)).toBe('ref-first')
    expect(loadGroupMode()).toBe('ref-first')

    persistGroupMode('ref-recent')
    expect(loadGroupMode()).toBe('ref-recent')
  })

  it('falls back to "date" when an invalid value is stored', () => {
    localStorage.setItem(GROUP_MODE_STORAGE_KEY, 'garbage')
    expect(loadGroupMode()).toBe('date')
  })

  it('survives a localStorage.getItem failure', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    expect(loadGroupMode()).toBe('date')
    spy.mockRestore()
  })
})
