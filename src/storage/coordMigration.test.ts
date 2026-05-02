import { describe, it, expect } from 'vitest'
import { shiftStrokes, shiftGuideState } from './coordMigration'
import type { Stroke } from '../drawing/types'
import type { GuideState } from '../guides/types'

describe('coordMigration', () => {
  describe('shiftStrokes', () => {
    it('shifts every point by (dx, dy) and preserves stroke timestamps', () => {
      const strokes: Stroke[] = [
        { points: [{ x: 100, y: 50 }, { x: 110, y: 60 }], timestamp: 1000 },
        { points: [{ x: 0, y: 0 }], timestamp: 2000 },
      ]
      const out = shiftStrokes(strokes, -50, -25)
      expect(out).toEqual([
        { points: [{ x: 50, y: 25 }, { x: 60, y: 35 }], timestamp: 1000 },
        { points: [{ x: -50, y: -25 }], timestamp: 2000 },
      ])
    })

    it('returns an empty array for no strokes', () => {
      expect(shiftStrokes([], -100, -100)).toEqual([])
    })

    it('legacy → center origin: shifting by (-W/2, -H/2) places top-left at (-W/2, -H/2)', () => {
      // A stroke that was drawn at the legacy "image top-left" world origin
      // (0, 0) should land at (-W/2, -H/2) under the new center-origin
      // convention. Equivalent: a stroke at the legacy image center (W/2, H/2)
      // should land at the new world origin (0, 0).
      const strokes: Stroke[] = [
        { points: [{ x: 0, y: 0 }, { x: 800, y: 600 }], timestamp: 1 },
      ]
      const out = shiftStrokes(strokes, -400, -300)
      expect(out[0].points).toEqual([{ x: -400, y: -300 }, { x: 400, y: 300 }])
    })
  })

  describe('shiftGuideState', () => {
    it('shifts every guide line endpoint and preserves grid settings + line ids', () => {
      const state: GuideState = {
        grid: { mode: 'normal' },
        lines: [
          { id: 'a', x1: 100, y1: 200, x2: 300, y2: 400 },
          { id: 'b', x1: 0, y1: 0, x2: 50, y2: 50 },
        ],
      }
      const out = shiftGuideState(state, -50, -100)
      expect(out.grid).toEqual({ mode: 'normal' })
      expect(out.lines).toEqual([
        { id: 'a', x1: 50, y1: 100, x2: 250, y2: 300 },
        { id: 'b', x1: -50, y1: -100, x2: 0, y2: -50 },
      ])
    })
  })
})
