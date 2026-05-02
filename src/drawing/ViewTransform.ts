import type { Point } from './types'

export interface Transform {
  offsetX: number
  offsetY: number
  scale: number
}

export interface ContainerSize {
  width: number
  height: number
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8

/**
 * Camera-model view transform. State is stored as a viewing center in world
 * coordinates plus a zoom multiplier — both container-independent — so a
 * shared transform can be projected differently into each panel's own canvas
 * (e.g. when the reference panel is collapsed and the drawing panel takes the
 * full screen). Container size and base scale (the fit-to-container ratio,
 * or 1 for free drawing) are passed into the projection methods at call time
 * rather than stored on the transform.
 *
 * Reset returns the camera to its registered "home" — typically the content
 * center at zoom 1 (image center for an image reference, or world origin for
 * free drawing). Callers wire this via {@link setHome}.
 */
export class ViewTransform {
  private viewCenterX = 0
  private viewCenterY = 0
  private zoom = 1
  private homeX = 0
  private homeY = 0
  private homeZoom = 1
  private listeners = new Set<() => void>()

  /**
   * Set the home position (and zoom) the camera resets to and snap the camera
   * to it. Callers invoke this on reference state changes (image load, video
   * load, reference unload), which the app treats as "view should land at the
   * new content center" — any prior pan/zoom is intentionally cleared.
   */
  setHome(centerX: number, centerY: number, zoom = 1): void {
    this.homeX = centerX
    this.homeY = centerY
    this.homeZoom = zoom
    if (this.viewCenterX === centerX && this.viewCenterY === centerY && this.zoom === zoom) {
      return
    }
    this.viewCenterX = centerX
    this.viewCenterY = centerY
    this.zoom = zoom
    this.notify()
  }

  reset(): void {
    if (this.isAtHomeInternal()) return
    this.viewCenterX = this.homeX
    this.viewCenterY = this.homeY
    this.zoom = this.homeZoom
    this.notify()
  }

  isDirty(): boolean {
    return !this.isAtHomeInternal()
  }

  private isAtHomeInternal(): boolean {
    return this.viewCenterX === this.homeX
      && this.viewCenterY === this.homeY
      && this.zoom === this.homeZoom
  }

  /**
   * Project the camera into a concrete (offsetX, offsetY, scale) transform
   * for a given canvas. `baseScale` is the fit-to-container scale (or 1 for
   * free drawing); the absolute scale applied is `baseScale * zoom`.
   */
  project(container: ContainerSize, baseScale: number): Transform {
    const scale = baseScale * this.zoom
    return {
      offsetX: container.width / 2 - this.viewCenterX * scale,
      offsetY: container.height / 2 - this.viewCenterY * scale,
      scale,
    }
  }

  screenToCanvas(screenX: number, screenY: number, container: ContainerSize, baseScale: number): Point {
    const t = this.project(container, baseScale)
    return {
      x: (screenX - t.offsetX) / t.scale,
      y: (screenY - t.offsetY) / t.scale,
    }
  }

  canvasToScreen(canvasX: number, canvasY: number, container: ContainerSize, baseScale: number): Point {
    const t = this.project(container, baseScale)
    return {
      x: canvasX * t.scale + t.offsetX,
      y: canvasY * t.scale + t.offsetY,
    }
  }

  /**
   * Pinch zoom + pan. `(focalX, focalY)` is the pinch focal point in canvas
   * screen coords; `scaleDelta` is the multiplicative zoom delta;
   * `(panX, panY)` is an additional screen-space translation applied after
   * zoom. Container + baseScale are needed to resolve the focal world point.
   */
  applyPinch(
    focalX: number,
    focalY: number,
    scaleDelta: number,
    panX: number,
    panY: number,
    container: ContainerSize,
    baseScale: number,
  ): void {
    if (scaleDelta === 1 && panX === 0 && panY === 0) return
    const oldScale = baseScale * this.zoom
    if (oldScale <= 0) return

    // World point at the focal screen point before the gesture.
    const focalWorldX = this.viewCenterX + (focalX - container.width / 2) / oldScale
    const focalWorldY = this.viewCenterY + (focalY - container.height / 2) / oldScale

    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * scaleDelta))
    const newScale = baseScale * newZoom

    // After the gesture we want the focal world point to land at
    // (focalX + panX, focalY + panY) in screen space — i.e. the gesture's
    // focal point follows the user's fingers.
    const targetX = focalX + panX
    const targetY = focalY + panY
    this.viewCenterX = focalWorldX - (targetX - container.width / 2) / newScale
    this.viewCenterY = focalWorldY - (targetY - container.height / 2) / newScale
    this.zoom = newZoom
    this.notify()
  }

  /** Apply the projected transform to a canvas rendering context. */
  applyToContext(ctx: CanvasRenderingContext2D, container: ContainerSize, baseScale: number): void {
    const t = this.project(container, baseScale)
    ctx.setTransform(t.scale, 0, 0, t.scale, t.offsetX, t.offsetY)
  }

  /** Current effective absolute scale for the given panel (baseScale * zoom). */
  getScale(baseScale: number): number {
    return baseScale * this.zoom
  }

  /** Camera state snapshot — useful for serialization or UI inspection. */
  getCamera(): { viewCenterX: number; viewCenterY: number; zoom: number } {
    return { viewCenterX: this.viewCenterX, viewCenterY: this.viewCenterY, zoom: this.zoom }
  }

  /** Subscribe to camera changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
