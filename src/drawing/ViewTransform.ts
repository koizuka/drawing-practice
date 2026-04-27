import type { Point } from './types'

export interface Transform {
  offsetX: number
  offsetY: number
  scale: number
}

export const IDENTITY_TRANSFORM: Transform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
}

const MIN_SCALE = 0.25
const MAX_SCALE = 8

export class ViewTransform {
  private transform: Transform
  private dirty = false
  private listeners = new Set<() => void>()

  constructor(initial?: Transform) {
    this.transform = initial ? { ...initial } : { ...IDENTITY_TRANSFORM }
  }

  get(): Transform {
    return { ...this.transform }
  }

  isDirty(): boolean {
    return this.dirty
  }

  reset(): void {
    this.transform = { ...IDENTITY_TRANSFORM }
    this.dirty = false
    this.notify()
  }

  /** Apply a pinch gesture: scale around a focal point and translate. */
  applyPinch(focalX: number, focalY: number, scaleDelta: number, translateX: number, translateY: number): void {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.transform.scale * scaleDelta))
    const actualScaleDelta = newScale / this.transform.scale

    // Scale around the focal point
    this.transform.offsetX = focalX - actualScaleDelta * (focalX - this.transform.offsetX) + translateX
    this.transform.offsetY = focalY - actualScaleDelta * (focalY - this.transform.offsetY) + translateY
    this.transform.scale = newScale
    this.dirty = true
    this.notify()
  }

  /** Fit a content rectangle into a container, centering and preserving aspect ratio. Atomic (single notify). */
  fitTo(container: { width: number; height: number }, content: { width: number; height: number }): void {
    const scale = Math.min(container.width / content.width, container.height / content.height)
    this.transform.offsetX = (container.width - content.width * scale) / 2
    this.transform.offsetY = (container.height - content.height * scale) / 2
    this.transform.scale = scale
    this.dirty = false
    this.notify()
  }

  /** Subscribe to transform changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** Convert screen coordinates to canvas coordinates. */
  screenToCanvas(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.transform.offsetX) / this.transform.scale,
      y: (screenY - this.transform.offsetY) / this.transform.scale,
    }
  }

  /** Convert canvas coordinates to screen coordinates. */
  canvasToScreen(canvasX: number, canvasY: number): Point {
    return {
      x: canvasX * this.transform.scale + this.transform.offsetX,
      y: canvasY * this.transform.scale + this.transform.offsetY,
    }
  }

  /** Apply transform to a canvas rendering context. */
  applyToContext(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(
      this.transform.scale, 0,
      0, this.transform.scale,
      this.transform.offsetX, this.transform.offsetY,
    )
  }
}
