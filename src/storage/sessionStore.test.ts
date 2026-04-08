import { vi, type Mock } from 'vitest'
import type { DraftData } from './sessionStore'

// Mock the db module before importing sessionStore
vi.mock('./db', () => ({
  db: {
    session: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

import { saveDraft, loadDraft, clearDraft } from './sessionStore'
import { db } from './db'

describe('sessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleDraft: DraftData = {
    strokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 }],
    redoStack: [],
    elapsedMs: 5000,
    source: 'sketchfab',
    referenceInfo: { title: 'Test Model', author: 'Author', source: 'sketchfab', sketchfabUid: 'abc123' },
    referenceImageData: 'data:image/png;base64,abc',
    guideState: {
      grid: { mode: 'normal' },
      lines: [{ id: 'guide-1', x1: 0, y1: 0, x2: 100, y2: 100 }],
    },
  }

  describe('saveDraft', () => {
    it('saves draft with id=1 and updatedAt timestamp', async () => {
      await saveDraft(sampleDraft)

      expect(db.session.put).toHaveBeenCalledTimes(1)
      const arg = (db.session.put as Mock).mock.calls[0][0]
      expect(arg.id).toBe(1)
      expect(arg.strokes).toEqual(sampleDraft.strokes)
      expect(arg.source).toBe('sketchfab')
      expect(arg.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('loadDraft', () => {
    it('returns undefined when no draft exists', async () => {
      const result = await loadDraft()
      expect(result).toBeUndefined()
      expect(db.session.get).toHaveBeenCalledWith(1)
    })

    it('returns draft when one exists', async () => {
      const stored = { ...sampleDraft, id: 1 as const, updatedAt: new Date() };
      (db.session.get as Mock).mockResolvedValueOnce(stored)

      const result = await loadDraft()
      expect(result).toEqual(stored)
    })
  })

  describe('clearDraft', () => {
    it('deletes the singleton draft record', async () => {
      await clearDraft()
      expect(db.session.delete).toHaveBeenCalledWith(1)
    })
  })
})
