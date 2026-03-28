import { GuideManager } from './GuideManager'

describe('GuideManager', () => {
  let manager: GuideManager

  beforeEach(() => {
    manager = new GuideManager()
  })

  describe('grid', () => {
    it('starts with grid disabled', () => {
      expect(manager.getGrid().enabled).toBe(false)
    })

    it('toggles grid', () => {
      manager.setGridEnabled(true)
      expect(manager.getGrid().enabled).toBe(true)
      manager.setGridEnabled(false)
      expect(manager.getGrid().enabled).toBe(false)
    })

    it('changes grid spacing', () => {
      manager.setGridSpacing(100)
      expect(manager.getGrid().spacing).toBe(100)
    })

    it('rejects spacing below 10', () => {
      manager.setGridSpacing(5)
      expect(manager.getGrid().spacing).toBe(100)
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
