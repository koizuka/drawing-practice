import { GuideManager } from './GuideManager'

describe('GuideManager', () => {
  let manager: GuideManager

  beforeEach(() => {
    manager = new GuideManager()
  })

  describe('grid', () => {
    it('starts with grid mode none', () => {
      expect(manager.getGrid().mode).toBe('none')
    })

    it('sets grid mode', () => {
      manager.setGridMode('normal')
      expect(manager.getGrid().mode).toBe('normal')
      manager.setGridMode('large')
      expect(manager.getGrid().mode).toBe('large')
      manager.setGridMode('none')
      expect(manager.getGrid().mode).toBe('none')
    })

    it('cycles grid mode: none → normal → large → none', () => {
      expect(manager.getGrid().mode).toBe('none')
      manager.cycleGridMode()
      expect(manager.getGrid().mode).toBe('normal')
      manager.cycleGridMode()
      expect(manager.getGrid().mode).toBe('large')
      manager.cycleGridMode()
      expect(manager.getGrid().mode).toBe('none')
    })
  })

  describe('guide lines', () => {
    it('adds a line', () => {
      const line = manager.addLine(0, 0, 100, 100)
      expect(line.id).toBeTruthy()
      expect(manager.getLines()).toHaveLength(1)
    })

    it('removes a line by id', () => {
      const line = manager.addLine(0, 0, 100, 100)
      expect(manager.removeLine(line.id)).toBe(true)
      expect(manager.getLines()).toHaveLength(0)
    })

    it('returns false for non-existent id', () => {
      expect(manager.removeLine('nonexistent')).toBe(false)
    })

    it('clears all lines', () => {
      manager.addLine(0, 0, 100, 100)
      manager.addLine(50, 50, 200, 200)
      manager.clearLines()
      expect(manager.getLines()).toHaveLength(0)
    })
  })

  describe('importState', () => {
    it('restores grid and lines from state', () => {
      const state = {
        grid: { mode: 'normal' as const },
        lines: [
          { id: 'guide-100', x1: 0, y1: 0, x2: 100, y2: 100 },
          { id: 'guide-101', x1: 50, y1: 50, x2: 200, y2: 200 },
        ],
      }

      manager.importState(state)

      expect(manager.getGrid().mode).toBe('normal')
      expect(manager.getLines()).toHaveLength(2)
      expect(manager.getLines()[0].id).toBe('guide-100')
    })

    it('migrates legacy enabled/spacing format', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacyState: any = {
        grid: { enabled: true, spacing: 50 },
        lines: [{ id: 'guide-100', x1: 0, y1: 0, x2: 100, y2: 100 }],
      }

      manager.importState(legacyState)

      expect(manager.getGrid().mode).toBe('normal')
      expect(manager.getLines()).toHaveLength(1)
    })

    it('migrates legacy disabled format', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacyState: any = {
        grid: { enabled: false, spacing: 100 },
        lines: [],
      }

      manager.importState(legacyState)

      expect(manager.getGrid().mode).toBe('none')
    })

    it('avoids id collisions after import', () => {
      manager.importState({
        grid: { mode: 'none' },
        lines: [{ id: 'guide-50', x1: 0, y1: 0, x2: 100, y2: 100 }],
      })

      const newLine = manager.addLine(0, 0, 50, 50)
      // New line id should be > 50 to avoid collision
      const idNum = parseInt(newLine.id.replace('guide-', ''), 10)
      expect(idNum).toBeGreaterThan(50)
    })

    it('creates independent copy of input state', () => {
      const state = {
        grid: { mode: 'normal' as const },
        lines: [{ id: 'guide-1', x1: 0, y1: 0, x2: 100, y2: 100 }],
      }

      manager.importState(state)
      state.lines.push({ id: 'guide-2', x1: 10, y1: 10, x2: 200, y2: 200 })

      expect(manager.getLines()).toHaveLength(1)
    })
  })

  describe('findNearestLine', () => {
    it('finds nearest line within threshold', () => {
      const line = manager.addLine(0, 0, 100, 0)
      const found = manager.findNearestLine(50, 5, 10)
      expect(found?.id).toBe(line.id)
    })

    it('returns null when no line is near', () => {
      manager.addLine(0, 0, 100, 0)
      const found = manager.findNearestLine(50, 50, 10)
      expect(found).toBeNull()
    })

    it('finds the closest of multiple lines', () => {
      manager.addLine(0, 0, 100, 0) // y=0
      const closer = manager.addLine(0, 10, 100, 10) // y=10
      const found = manager.findNearestLine(50, 12, 20)
      expect(found?.id).toBe(closer.id)
    })
  })
})
