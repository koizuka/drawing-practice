import type { Point } from './types';

export interface Transform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ContainerSize {
  width: number;
  height: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Mutators carry an intent so SplitLayout can pick the right autosave-flush
 * policy without reverse-inferring it from state (`isDirty()` post-hoc,
 * fitSize transition-direction, etc.). {@link adjustForUnfit} notifies with
 * intent `null` because it's a render-side scale fix-up, not a user action.
 */
export type CameraIntent = 'contentLoad' | 'restore' | 'userReset' | 'gesture';

/**
 * Camera-model view transform. State is stored as a viewing center in world
 * coordinates plus a zoom multiplier — both container-independent — so a
 * shared transform can be projected differently into each panel's own canvas
 * (e.g. when the reference panel is collapsed and the drawing panel takes the
 * full screen). Container size and base scale (the fit-to-container ratio,
 * or 1 for free drawing) are passed into the projection methods at call time
 * rather than stored on the transform.
 *
 * Mutators are named after the UI event they represent ({@link loadContent},
 * {@link userResetToHome}, {@link restoreCamera}, {@link applyGesture},
 * {@link adjustForUnfit}); the matching {@link CameraIntent} is forwarded to
 * subscribers so listeners can branch on intent rather than re-inferring it.
 */
export class ViewTransform {
  private viewCenterX = 0;
  private viewCenterY = 0;
  private zoom = 1;
  private homeX = 0;
  private homeY = 0;
  private homeZoom = 1;
  private listeners = new Set<(intent: CameraIntent | null) => void>();

  /**
   * The active fitting viewer just loaded new content (image onload, video
   * mount, fixed-image swap, Fix Angle confirm). Register the content's
   * center as the new home and snap the camera there — any prior pan/zoom is
   * intentionally cleared. Emits intent `'contentLoad'`.
   */
  loadContent(centerX: number, centerY: number, zoom = 1): void {
    this.homeX = centerX;
    this.homeY = centerY;
    this.homeZoom = zoom;
    if (this.viewCenterX === centerX && this.viewCenterY === centerY && this.zoom === zoom) {
      return;
    }
    this.viewCenterX = centerX;
    this.viewCenterY = centerY;
    this.zoom = zoom;
    this.notify('contentLoad');
  }

  /** User clicked the reset-zoom button or pressed Cmd/Ctrl+0. Emits `'userReset'`. */
  userResetToHome(): void {
    if (this.isAtHomeInternal()) return;
    this.viewCenterX = this.homeX;
    this.viewCenterY = this.homeY;
    this.zoom = this.homeZoom;
    this.notify('userReset');
  }

  /**
   * Restore a persisted camera (e.g. after page reload) without disturbing
   * the registered home. `zoom` is clamped to the same range as gestures.
   * Emits `'restore'` — SplitLayout's `suppressAutosaveRef` is up during the
   * restore window, so this intent does NOT trigger an immediate flush.
   */
  restoreCamera(viewCenterX: number, viewCenterY: number, zoom: number): void {
    const clampedZoom = clampZoom(zoom);
    if (this.viewCenterX === viewCenterX
      && this.viewCenterY === viewCenterY
      && this.zoom === clampedZoom) return;
    this.viewCenterX = viewCenterX;
    this.viewCenterY = viewCenterY;
    this.zoom = clampedZoom;
    this.notify('restore');
  }

  /**
   * Adjust `zoom` so that `visualScale = baseScale × zoom` stays continuous
   * across a `baseScale` change. Used when the drawing canvas's fit size
   * disappears (closing a reference): without this the strokes would visibly
   * jump in size even though the camera state is unchanged numerically.
   * Notifies with intent `null` — this is a render-side adjustment, not a
   * user-driven camera move, so SplitLayout's flush listener skips it.
   */
  adjustForUnfit(prevBaseScale: number, newBaseScale: number): void {
    if (prevBaseScale <= 0 || newBaseScale <= 0) return;
    if (prevBaseScale === newBaseScale) return;
    const newZoom = clampZoom(this.zoom * (prevBaseScale / newBaseScale));
    if (newZoom === this.zoom) return;
    this.zoom = newZoom;
    this.notify(null);
  }

  isDirty(): boolean {
    return !this.isAtHomeInternal();
  }

  private isAtHomeInternal(): boolean {
    return this.viewCenterX === this.homeX
      && this.viewCenterY === this.homeY
      && this.zoom === this.homeZoom;
  }

  /**
   * Project the camera into a concrete (offsetX, offsetY, scale) transform
   * for a given canvas. `baseScale` is the fit-to-container scale (or 1 for
   * free drawing); the absolute scale applied is `baseScale * zoom`.
   */
  project(container: ContainerSize, baseScale: number): Transform {
    const scale = baseScale * this.zoom;
    return {
      offsetX: container.width / 2 - this.viewCenterX * scale,
      offsetY: container.height / 2 - this.viewCenterY * scale,
      scale,
    };
  }

  screenToCanvas(screenX: number, screenY: number, container: ContainerSize, baseScale: number): Point {
    const t = this.project(container, baseScale);
    return {
      x: (screenX - t.offsetX) / t.scale,
      y: (screenY - t.offsetY) / t.scale,
    };
  }

  canvasToScreen(canvasX: number, canvasY: number, container: ContainerSize, baseScale: number): Point {
    const t = this.project(container, baseScale);
    return {
      x: canvasX * t.scale + t.offsetX,
      y: canvasY * t.scale + t.offsetY,
    };
  }

  /**
   * Pinch zoom + pan (or wheel scroll). `(focalX, focalY)` is the gesture
   * focal point in canvas screen coords; `scaleDelta` is the multiplicative
   * zoom delta; `(panX, panY)` is an additional screen-space translation
   * applied after zoom. Container + baseScale are needed to resolve the focal
   * world point. Emits `'gesture'` — SplitLayout tail-debounces flush so
   * one save fires per gesture instead of per frame.
   */
  applyGesture(
    focalX: number,
    focalY: number,
    scaleDelta: number,
    panX: number,
    panY: number,
    container: ContainerSize,
    baseScale: number,
  ): void {
    if (scaleDelta === 1 && panX === 0 && panY === 0) return;
    const oldScale = baseScale * this.zoom;
    if (oldScale <= 0) return;

    // World point at the focal screen point before the gesture.
    const focalWorldX = this.viewCenterX + (focalX - container.width / 2) / oldScale;
    const focalWorldY = this.viewCenterY + (focalY - container.height / 2) / oldScale;

    const newZoom = clampZoom(this.zoom * scaleDelta);
    const newScale = baseScale * newZoom;

    // After the gesture we want the focal world point to land at
    // (focalX + panX, focalY + panY) in screen space — i.e. the gesture's
    // focal point follows the user's fingers.
    const targetX = focalX + panX;
    const targetY = focalY + panY;
    this.viewCenterX = focalWorldX - (targetX - container.width / 2) / newScale;
    this.viewCenterY = focalWorldY - (targetY - container.height / 2) / newScale;
    this.zoom = newZoom;
    this.notify('gesture');
  }

  /** Apply the projected transform to a canvas rendering context. */
  applyToContext(ctx: CanvasRenderingContext2D, container: ContainerSize, baseScale: number): void {
    const t = this.project(container, baseScale);
    ctx.setTransform(t.scale, 0, 0, t.scale, t.offsetX, t.offsetY);
  }

  /** Current effective absolute scale for the given panel (baseScale * zoom). */
  getScale(baseScale: number): number {
    return baseScale * this.zoom;
  }

  /** Camera state snapshot — useful for serialization or UI inspection. */
  getCamera(): { viewCenterX: number; viewCenterY: number; zoom: number } {
    return { viewCenterX: this.viewCenterX, viewCenterY: this.viewCenterY, zoom: this.zoom };
  }

  /**
   * Subscribe to camera changes. The listener receives the {@link CameraIntent}
   * that drove the change, or `null` for render-side adjustments
   * ({@link adjustForUnfit}) that should not trigger user-intent handling.
   * Listeners that only care about repainting can ignore the argument.
   */
  subscribe(listener: (intent: CameraIntent | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(intent: CameraIntent | null): void {
    for (const listener of this.listeners) listener(intent);
  }
}
