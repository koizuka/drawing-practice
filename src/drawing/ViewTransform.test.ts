import { vi } from 'vitest'
import { ViewTransform } from './ViewTransform'

describe('ViewTransform', () => {
  let vt: ViewTransform

  beforeEach(() => {
    vt = new ViewTransform()
  })

  it('starts with identity transform', () => {
    const t = vt.get()
    expect(t.offsetX).toBe(0)
    expect(t.offsetY).toBe(0)
    expect(t.scale).toBe(1)
  })

  it('converts screen to canvas coordinates at identity', () => {
    const p = vt.screenToCanvas(100, 200)
    expect(p.x).toBe(100)
    expect(p.y).toBe(200)
  })

  it('converts canvas to screen coordinates at identity', () => {
    const p = vt.canvasToScreen(100, 200)
    expect(p.x).toBe(100)
    expect(p.y).toBe(200)
  })

  it('screenToCanvas and canvasToScreen are inverse operations', () => {
    vt.applyPinch(50, 50, 2, 10, 20)
    const screen = { x: 150, y: 250 }
    const canvas = vt.screenToCanvas(screen.x, screen.y)
    const back = vt.canvasToScreen(canvas.x, canvas.y)
    expect(back.x).toBeCloseTo(screen.x)
    expect(back.y).toBeCloseTo(screen.y)
  })

  it('applies pinch zoom', () => {
    vt.applyPinch(100, 100, 2, 0, 0)
    const t = vt.get()
    expect(t.scale).toBe(2)
    // Focal point stays fixed: screenToCanvas(100, 100) should give the same result
    const p = vt.screenToCanvas(100, 100)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(100)
  })

  it('clamps scale to min/max', () => {
    vt.applyPinch(0, 0, 0.01, 0, 0)
    expect(vt.get().scale).toBe(0.25)

    vt.reset()
    vt.applyPinch(0, 0, 100, 0, 0)
    expect(vt.get().scale).toBe(8)
  })

  it('resets to identity', () => {
    vt.applyPinch(50, 50, 3, 10, 20)
    vt.reset()
    const t = vt.get()
    expect(t.offsetX).toBe(0)
    expect(t.offsetY).toBe(0)
    expect(t.scale).toBe(1)
  })

  it('applies translation via pinch', () => {
    vt.applyPinch(0, 0, 1, 50, 30)
    const t = vt.get()
    expect(t.offsetX).toBe(50)
    expect(t.offsetY).toBe(30)
    expect(t.scale).toBe(1)
  })

  describe('fitTo', () => {
    it('fits content smaller than container and centers it', () => {
      vt.fitTo({ width: 400, height: 300 }, { width: 200, height: 100 })
      const t = vt.get()
      expect(t.scale).toBe(2)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(50)
    })

    it('fits content larger than container, preserving aspect ratio', () => {
      vt.fitTo({ width: 200, height: 200 }, { width: 400, height: 400 })
      const t = vt.get()
      expect(t.scale).toBe(0.5)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(0)
    })

    it('overwrites any prior transform', () => {
      vt.applyPinch(100, 100, 4, 0, 0)
      vt.fitTo({ width: 200, height: 100 }, { width: 200, height: 100 })
      const t = vt.get()
      expect(t.scale).toBe(1)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(0)
    })
  })

  describe('isDirty', () => {
    it('starts clean', () => {
      expect(vt.isDirty()).toBe(false)
    })

    it('becomes dirty after applyPinch', () => {
      vt.applyPinch(0, 0, 2, 0, 0)
      expect(vt.isDirty()).toBe(true)
    })

    it('becomes clean after reset', () => {
      vt.applyPinch(0, 0, 2, 0, 0)
      vt.reset()
      expect(vt.isDirty()).toBe(false)
    })

    it('becomes clean after fitTo', () => {
      vt.applyPinch(0, 0, 2, 0, 0)
      vt.fitTo({ width: 100, height: 100 }, { width: 50, height: 50 })
      expect(vt.isDirty()).toBe(false)
    })

    it('notifies listeners when dirty flag flips', () => {
      const states: boolean[] = []
      vt.subscribe(() => states.push(vt.isDirty()))
      vt.applyPinch(0, 0, 2, 0, 0)
      vt.reset()
      expect(states).toEqual([true, false])
    })
  })

  describe('subscribe', () => {
    it('notifies listener when applyPinch is called', () => {
      const listener = vi.fn()
      vt.subscribe(listener)
      vt.applyPinch(0, 0, 2, 0, 0)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('notifies listener when reset is called', () => {
      const listener = vi.fn()
      vt.subscribe(listener)
      vt.reset()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('notifies listener once per fitTo call (atomic)', () => {
      const listener = vi.fn()
      vt.subscribe(listener)
      vt.fitTo({ width: 100, height: 100 }, { width: 50, height: 50 })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('notifies multiple listeners', () => {
      const a = vi.fn()
      const b = vi.fn()
      vt.subscribe(a)
      vt.subscribe(b)
      vt.applyPinch(0, 0, 2, 0, 0)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('unsubscribed listener does not fire', () => {
      const listener = vi.fn()
      const unsubscribe = vt.subscribe(listener)
      unsubscribe()
      vt.applyPinch(0, 0, 2, 0, 0)
      vt.reset()
      vt.fitTo({ width: 10, height: 10 }, { width: 5, height: 5 })
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
