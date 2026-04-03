import { StrokeManager } from './StrokeManager'

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
  })
})
