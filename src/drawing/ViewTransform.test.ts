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
})
