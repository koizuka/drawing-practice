import { describe, it, expect } from 'vitest'
import { quantizeStrokesForStorage } from './drawingStore'
import type { Stroke } from '../drawing/types'

describe('quantizeStrokesForStorage', () => {
  it('rounds coordinates to 0.1px', () => {
    const input: Stroke[] = [{
      points: [
        { x: 12.34567, y: 23.45678 },
        { x: 99.96, y: 50.01 },
      ],
      timestamp: 1000,
    }]
    const out = quantizeStrokesForStorage(input)
    expect(out).toEqual([{
      points: [
        { x: 12.3, y: 23.5 },
        { x: 100, y: 50 },
      ],
      timestamp: 1000,
    }])
  })

  it('drops points that collapse onto the previous point after quantization', () => {
    const input: Stroke[] = [{
      points: [
        { x: 12.34, y: 23.45 },
        { x: 12.32, y: 23.46 },
        { x: 12.30, y: 23.49 },
        { x: 80, y: 80 },
      ],
      timestamp: 0,
    }]
    const out = quantizeStrokesForStorage(input)
    expect(out[0].points).toEqual([
      { x: 12.3, y: 23.5 },
      { x: 80, y: 80 },
    ])
  })

  it('preserves shape across multiple strokes independently', () => {
    const input: Stroke[] = [
      { points: [{ x: 1.111, y: 2.222 }], timestamp: 1 },
      { points: [{ x: 3.333, y: 4.444 }, { x: 5.555, y: 6.666 }], timestamp: 2 },
    ]
    const out = quantizeStrokesForStorage(input)
    expect(out).toEqual([
      { points: [{ x: 1.1, y: 2.2 }], timestamp: 1 },
      { points: [{ x: 3.3, y: 4.4 }, { x: 5.6, y: 6.7 }], timestamp: 2 },
    ])
  })

  it('handles empty stroke list', () => {
    expect(quantizeStrokesForStorage([])).toEqual([])
  })

  it('keeps a single-point stroke', () => {
    const input: Stroke[] = [{ points: [{ x: 5.55, y: 6.66 }], timestamp: 7 }]
    expect(quantizeStrokesForStorage(input)).toEqual([
      { points: [{ x: 5.6, y: 6.7 }], timestamp: 7 },
    ])
  })

  it('does not mutate the input strokes', () => {
    const input: Stroke[] = [{
      points: [{ x: 1.234, y: 5.678 }],
      timestamp: 42,
    }]
    const snapshot = JSON.stringify(input)
    quantizeStrokesForStorage(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
