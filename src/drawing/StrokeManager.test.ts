import { vi } from 'vitest'
import { StrokeManager } from './StrokeManager'
import type { ReferenceSnapshot } from './types'

function snap(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
  return {
    source: 'none',
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: null,
    ...overrides,
  }
}

describe('StrokeManager', () => {
  let manager: StrokeManager

  beforeEach(() => {
    manager = new StrokeManager()
  })

  describe('stroke recording', () => {
    it('records a stroke with multiple points', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.appendStroke({ x: 20, y: 20 })
      const stroke = manager.endStroke()

      expect(stroke).not.toBeNull()
      expect(stroke!.points).toHaveLength(3)
      expect(manager.getStrokes()).toHaveLength(1)
    })

    it('discards strokes with fewer than 2 points', () => {
      manager.startStroke({ x: 0, y: 0 })
      const stroke = manager.endStroke()

      expect(stroke).toBeNull()
      expect(manager.getStrokes()).toHaveLength(0)
    })

    it('ignores appendStroke when no stroke is active', () => {
      manager.appendStroke({ x: 10, y: 10 })
      expect(manager.getCurrentStroke()).toBeNull()
    })

    it('tracks current stroke during drawing', () => {
      manager.startStroke({ x: 0, y: 0 })
      expect(manager.getCurrentStroke()).not.toBeNull()

      manager.appendStroke({ x: 10, y: 10 })
      expect(manager.getCurrentStroke()!.points).toHaveLength(2)

      manager.endStroke()
      expect(manager.getCurrentStroke()).toBeNull()
    })
  })

  describe('undo/redo', () => {
    it('undoes the last stroke', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      expect(manager.canUndo()).toBe(true)
      const undone = manager.undo()
      expect(undone).not.toBeNull()
      expect(manager.getStrokes()).toHaveLength(0)
    })

    it('redoes an undone stroke', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.undo()
      expect(manager.canRedo()).toBe(true)

      const redone = manager.redo()
      expect(redone).not.toBeNull()
      expect(manager.getStrokes()).toHaveLength(1)
    })

    it('clears redo stack when a new stroke is drawn', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.undo()
      expect(manager.canRedo()).toBe(true)

      manager.startStroke({ x: 5, y: 5 })
      manager.appendStroke({ x: 15, y: 15 })
      manager.endStroke()

      expect(manager.canRedo()).toBe(false)
    })

    it('returns null when nothing to undo/redo', () => {
      expect(manager.undo()).toBeNull()
      expect(manager.redo()).toBeNull()
      expect(manager.canUndo()).toBe(false)
      expect(manager.canRedo()).toBe(false)
    })
  })

  describe('deleteStroke', () => {
    it('deletes a stroke by index', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      const deleted = manager.deleteStroke(0)
      expect(deleted).not.toBeNull()
      expect(manager.getStrokes()).toHaveLength(1)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 })
    })

    it('returns null for invalid index', () => {
      expect(manager.deleteStroke(-1)).toBeNull()
      expect(manager.deleteStroke(0)).toBeNull()
    })

    it('clears redo stack on delete', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.undo()
      expect(manager.canRedo()).toBe(true)

      manager.deleteStroke(0)
      expect(manager.canRedo()).toBe(false)
    })

    it('can undo a delete operation', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.deleteStroke(0)
      expect(manager.getStrokes()).toHaveLength(1)
      expect(manager.canUndo()).toBe(true)

      manager.undo()
      expect(manager.getStrokes()).toHaveLength(2)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 })
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 })
    })

    it('undo after delete restores stroke at original index', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.startStroke({ x: 40, y: 40 })
      manager.appendStroke({ x: 50, y: 50 })
      manager.endStroke()

      // Delete middle stroke
      manager.deleteStroke(1)
      expect(manager.getStrokes()).toHaveLength(2)

      manager.undo()
      expect(manager.getStrokes()).toHaveLength(3)
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 })
    })

    it('can undo multiple consecutive deletes', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.startStroke({ x: 40, y: 40 })
      manager.appendStroke({ x: 50, y: 50 })
      manager.endStroke()

      // Delete first, then second (now at index 0)
      manager.deleteStroke(0)
      manager.deleteStroke(0)
      expect(manager.getStrokes()).toHaveLength(1)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 40, y: 40 })

      // Undo both deletes
      manager.undo()
      expect(manager.getStrokes()).toHaveLength(2)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 })

      manager.undo()
      expect(manager.getStrokes()).toHaveLength(3)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 0, y: 0 })
    })

    it('undo interleaves add and delete in chronological order', () => {
      // Draw 3 strokes
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.startStroke({ x: 40, y: 40 })
      manager.appendStroke({ x: 50, y: 50 })
      manager.endStroke()

      // Delete middle stroke, then draw another
      manager.deleteStroke(1)
      expect(manager.getStrokes()).toHaveLength(2)

      manager.startStroke({ x: 60, y: 60 })
      manager.appendStroke({ x: 70, y: 70 })
      manager.endStroke()
      expect(manager.getStrokes()).toHaveLength(3)

      // Undo should reverse: remove last added, then restore deleted
      manager.undo() // undo add of (60,60)
      expect(manager.getStrokes()).toHaveLength(2)
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 40, y: 40 })

      manager.undo() // undo delete of (20,20)
      expect(manager.getStrokes()).toHaveLength(3)
      expect(manager.getStrokes()[1].points[0]).toEqual({ x: 20, y: 20 })

      manager.undo() // undo add of (40,40)
      expect(manager.getStrokes()).toHaveLength(2)
    })

    it('redo replays delete after undo', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      manager.deleteStroke(0)
      expect(manager.getStrokes()).toHaveLength(1)

      manager.undo() // restore deleted stroke
      expect(manager.getStrokes()).toHaveLength(2)

      manager.redo() // re-delete
      expect(manager.getStrokes()).toHaveLength(1)
      expect(manager.getStrokes()[0].points[0]).toEqual({ x: 20, y: 20 })
    })

    it('new stroke clears delete undo', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.deleteStroke(0)
      expect(manager.getStrokes()).toHaveLength(0)
      expect(manager.canUndo()).toBe(true)

      // Draw a new stroke — delete undo is lost
      manager.startStroke({ x: 50, y: 50 })
      manager.appendStroke({ x: 60, y: 60 })
      manager.endStroke()

      expect(manager.getStrokes()).toHaveLength(1)
      // Undo now undoes the new stroke, not the delete
      manager.undo()
      expect(manager.getStrokes()).toHaveLength(0)
    })
  })

  describe('findNearestStroke', () => {
    it('finds the nearest stroke within threshold', () => {
      manager.startStroke({ x: 100, y: 100 })
      manager.appendStroke({ x: 110, y: 110 })
      manager.endStroke()

      manager.startStroke({ x: 200, y: 200 })
      manager.appendStroke({ x: 210, y: 210 })
      manager.endStroke()

      const index = manager.findNearestStroke({ x: 105, y: 105 }, 20)
      expect(index).toBe(0)
    })

    it('returns null when no stroke is within threshold', () => {
      manager.startStroke({ x: 100, y: 100 })
      manager.appendStroke({ x: 110, y: 110 })
      manager.endStroke()

      const index = manager.findNearestStroke({ x: 500, y: 500 }, 20)
      expect(index).toBeNull()
    })
  })

  describe('loadState', () => {
    it('restores strokes and redo stack', () => {
      const strokes = [
        { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 },
        { points: [{ x: 20, y: 20 }, { x: 30, y: 30 }], timestamp: 2000 },
      ]
      const redoStack = [
        { points: [{ x: 40, y: 40 }, { x: 50, y: 50 }], timestamp: 3000 },
      ]

      manager.loadState(strokes, redoStack)

      expect(manager.getStrokes()).toHaveLength(2)
      expect(manager.getRedoStack()).toHaveLength(1)
      expect(manager.canUndo()).toBe(true)
      expect(manager.canRedo()).toBe(true)
    })

    it('clears current stroke on load', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.loadState([], [])

      expect(manager.getCurrentStroke()).toBeNull()
      expect(manager.getStrokes()).toHaveLength(0)
    })

    it('creates independent copies of input arrays', () => {
      const strokes = [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 }]
      manager.loadState(strokes, [])

      strokes.push({ points: [{ x: 20, y: 20 }, { x: 30, y: 30 }], timestamp: 2000 })
      expect(manager.getStrokes()).toHaveLength(1)
    })
  })

  describe('getRedoStack', () => {
    it('returns empty redo stack initially', () => {
      expect(manager.getRedoStack()).toHaveLength(0)
    })

    it('returns redo stack after undo', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.undo()
      expect(manager.getRedoStack()).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('removes all strokes and resets state', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.clear()
      expect(manager.getStrokes()).toHaveLength(0)
      expect(manager.canUndo()).toBe(false)
      expect(manager.canRedo()).toBe(false)
      expect(manager.getCurrentStroke()).toBeNull()
    })

    it('also discards reference history', () => {
      manager.setReferenceRestorer(vi.fn())
      manager.recordReferenceChange(snap({ source: 'none' }))
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.clear()
      expect(manager.canUndo()).toBe(false)
      expect(manager.canRedo()).toBe(false)
    })
  })

  describe('reference history', () => {
    it('records a reference change in the undo stack', () => {
      expect(manager.canUndo()).toBe(false)
      manager.recordReferenceChange(snap({ source: 'none' }))
      expect(manager.canUndo()).toBe(true)
      expect(manager.canRedo()).toBe(false)
    })

    it('invokes the restorer with the previous snapshot on undo', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      const prev = snap({ source: 'none' })
      manager.recordReferenceChange(prev)

      const current = snap({ source: 'sketchfab', referenceMode: 'fixed', fixedImageUrl: 'data:current' })
      const result = manager.undo(() => current)

      expect(result).toEqual({ kind: 'reference' })
      expect(restorer).toHaveBeenCalledTimes(1)
      expect(restorer).toHaveBeenCalledWith(prev)
    })

    it('does not crash when undo pops a reference entry with no restorer set', () => {
      manager.recordReferenceChange(snap({ source: 'none' }))
      expect(() => manager.undo(() => snap())).not.toThrow()
      expect(manager.canUndo()).toBe(false)
    })

    it('redo re-applies the most recent snapshot after a reference undo', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      const prev = snap({ source: 'none' })
      const current = snap({ source: 'sketchfab', referenceMode: 'fixed', fixedImageUrl: 'data:A' })
      manager.recordReferenceChange(prev)

      manager.undo(() => current)
      expect(restorer).toHaveBeenLastCalledWith(prev)
      expect(manager.canRedo()).toBe(true)

      // After the undo, the "current" state is `prev`; redo pushes it back onto the undo stack
      manager.redo(() => prev)
      expect(restorer).toHaveBeenLastCalledWith(current)
      expect(manager.canRedo()).toBe(false)
      expect(manager.canUndo()).toBe(true)
    })

    it('does not call captureCurrentRef when undoing a stroke entry', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      const capture = vi.fn(() => snap())
      const result = manager.undo(capture)
      expect(result?.kind).toBe('stroke')
      expect(capture).not.toHaveBeenCalled()
    })

    it('calls captureCurrentRef exactly once when undoing a reference entry', () => {
      manager.recordReferenceChange(snap())

      const capture = vi.fn(() => snap({ source: 'image' }))
      manager.undo(capture)
      expect(capture).toHaveBeenCalledTimes(1)
    })

    it('undoes the initial reference load back to the none snapshot', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      const noneSnap = snap({ source: 'none' })
      manager.recordReferenceChange(noneSnap)

      const afterLoad = snap({ source: 'image', referenceMode: 'fixed', localImageUrl: 'data:img' })
      manager.undo(() => afterLoad)

      expect(restorer).toHaveBeenCalledWith(noneSnap)
    })

    it('undoes and redoes strokes and references in chronological order', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      const snapA = snap({ source: 'none' })
      const snapB = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:B' })
      const snapC = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:C' })

      // stroke1
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      // ref A → B
      manager.recordReferenceChange(snapA)

      // stroke2
      manager.startStroke({ x: 20, y: 20 })
      manager.appendStroke({ x: 30, y: 30 })
      manager.endStroke()

      // ref B → C
      manager.recordReferenceChange(snapB)

      // stroke3
      manager.startStroke({ x: 40, y: 40 })
      manager.appendStroke({ x: 50, y: 50 })
      manager.endStroke()

      expect(manager.getStrokes()).toHaveLength(3)

      // ---- Undo × 5 ----
      // 1: stroke3 removed
      expect(manager.undo(() => snapC)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(2)

      // 2: ref C → B (capture passes current snapC so redo can restore it)
      expect(manager.undo(() => snapC)?.kind).toBe('reference')
      expect(restorer).toHaveBeenLastCalledWith(snapB)

      // 3: stroke2 removed
      expect(manager.undo(() => snapB)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(1)

      // 4: ref B → A
      expect(manager.undo(() => snapB)?.kind).toBe('reference')
      expect(restorer).toHaveBeenLastCalledWith(snapA)

      // 5: stroke1 removed
      expect(manager.undo(() => snapA)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(0)
      expect(manager.canUndo()).toBe(false)

      // ---- Redo × 5 ----
      expect(manager.redo(() => snapA)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(1)

      expect(manager.redo(() => snapA)?.kind).toBe('reference')
      expect(restorer).toHaveBeenLastCalledWith(snapB)

      expect(manager.redo(() => snapB)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(2)

      expect(manager.redo(() => snapB)?.kind).toBe('reference')
      expect(restorer).toHaveBeenLastCalledWith(snapC)

      expect(manager.redo(() => snapC)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(3)
      expect(manager.canRedo()).toBe(false)
    })

    it('clears the redo stack when a new stroke is drawn after a reference undo', () => {
      manager.setReferenceRestorer(vi.fn())
      manager.recordReferenceChange(snap())
      manager.undo(() => snap({ source: 'image' }))
      expect(manager.canRedo()).toBe(true)

      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      expect(manager.canRedo()).toBe(false)
    })

    it('clears the redo stack when a new reference change is recorded after undo', () => {
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()
      manager.undo()
      expect(manager.canRedo()).toBe(true)

      manager.recordReferenceChange(snap())
      expect(manager.canRedo()).toBe(false)
    })

    it('interleaves deleteStroke and reference changes correctly', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      const snapA = snap({ source: 'none' })
      const snapB = snap({ source: 'image', referenceMode: 'fixed', fixedImageUrl: 'data:B' })

      // Draw a stroke, then change ref A→B, then delete the stroke
      manager.startStroke({ x: 0, y: 0 })
      manager.appendStroke({ x: 10, y: 10 })
      manager.endStroke()

      manager.recordReferenceChange(snapA)

      manager.deleteStroke(0)
      expect(manager.getStrokes()).toHaveLength(0)

      // Undo #1: restore delete
      expect(manager.undo(() => snapB)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(1)

      // Undo #2: ref B → A
      expect(manager.undo(() => snapB)?.kind).toBe('reference')
      expect(restorer).toHaveBeenLastCalledWith(snapA)

      // Undo #3: remove the original stroke add
      expect(manager.undo(() => snapA)?.kind).toBe('stroke')
      expect(manager.getStrokes()).toHaveLength(0)
    })

    it('prunes the oldest reference entries when exceeding the history cap', () => {
      const restorer = vi.fn()
      manager.setReferenceRestorer(restorer)

      // Cap is 20. Record 25 reference changes; only the last 20 should survive.
      const snapshots: ReferenceSnapshot[] = []
      for (let i = 0; i < 25; i++) {
        const s = snap({ source: 'image', fixedImageUrl: `data:${i}` })
        snapshots.push(s)
        manager.recordReferenceChange(s)
      }

      // Undo everything and collect the restored snapshots.
      const restored: ReferenceSnapshot[] = []
      while (manager.canUndo()) {
        manager.undo(() => snap({ source: 'image' }))
      }
      for (const call of restorer.mock.calls) {
        restored.push(call[0] as ReferenceSnapshot)
      }

      // Should have 20 restorations in reverse chronological order: snapshots[24]..snapshots[5]
      expect(restored).toHaveLength(20)
      expect(restored[0]).toEqual(snapshots[24])
      expect(restored[19]).toEqual(snapshots[5])
    })

    it('loadState() does not populate reference history', () => {
      const restorer = vi.fn()
      const strokes = [
        { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 },
      ]
      manager.loadState(strokes, [])
      manager.setReferenceRestorer(restorer)

      // Only the stroke add should be in the undo stack; no reference entry
      const result = manager.undo(() => snap({ source: 'image' }))
      expect(result?.kind).toBe('stroke')
      expect(restorer).not.toHaveBeenCalled()
    })

    it('keeps the reference count consistent when redo receives no captureCurrentRef', () => {
      manager.setReferenceRestorer(vi.fn())
      manager.recordReferenceChange(snap({ source: 'none' }))
      // Undo with a capture so the entry moves to the redo stack
      manager.undo(() => snap({ source: 'image', fixedImageUrl: 'data:A' }))

      // Redo WITHOUT a captureCurrentRef — the entry cannot be pushed back onto
      // the undo stack, so the count must not be incremented either.
      manager.redo()

      // Recording 20 more changes must succeed without pruneReferenceHistory
      // thinking the cap is already exceeded due to a stale count.
      for (let i = 0; i < 20; i++) {
        manager.recordReferenceChange(snap({ source: 'image', fixedImageUrl: `data:${i}` }))
      }

      // Exactly MAX_REFERENCE_HISTORY (20) reference entries should be in the
      // undo stack; 21 would mean the count was off by one.
      let refEntriesInStack = 0
      while (manager.canUndo()) {
        const result = manager.undo(() => snap())
        if (result?.kind === 'reference') refEntriesInStack++
      }
      expect(refEntriesInStack).toBe(20)
    })
  })
})
