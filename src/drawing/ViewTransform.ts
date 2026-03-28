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

  constructor(initial?: Transform) {
    this.transform = initial ? { ...initial } : { ...IDENTITY_TRANSFORM }
  }

  get(): Transform {
    return { ...this.transform }
  }

  reset(): void {
    this.transform = { ...IDENTITY_TRANSFORM }
  }

  /** Apply a pinch gesture: scale around a focal point and translate. */
  applyPinch(focalX: number, focalY: number, scaleDelta: number, translateX: number, translateY: number): void {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.transform.scale * scaleDelta))
    const actualScaleDelta = newScale / this.transform.scale

    // Scale around the focal point
    this.transform.offsetX = focalX - actualScaleDelta * (focalX - this.transform.offsetX) + translateX
    this.transform.offsetY = focalY - actualScaleDelta * (focalY - this.transform.offsetY) + translateY
    this.transform.scale = newScale
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
