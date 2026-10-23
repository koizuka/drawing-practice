import type { Point } from './types';

export interface Transform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/**
 * Full 2D affine projection (`ctx.setTransform(a, b, c, d, e, f)` order) for
 * panels that honour the camera rotation. `scale` is the uniform zoom factor
 * (|a,b|), kept alongside so callers can zoom-compensate line widths without
 * re-deriving it from the matrix.
 */
export interface ProjectionMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
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

/** Normalize an angle (radians) into (-π, π]. */
export function normalizeRotation(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  let r = rad % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  // Collapse -0 so `rotation === 0` comparisons and persistence stay clean.
  return r === 0 ? 0 : r;
}

export interface GestureOptions {
  /**
   * The calling panel renders with the camera rotation applied (drawing
   * panel). Focal / pan screen coordinates are then interpreted in the
   * rotated frame. Panels that always render upright (reference viewers)
   * leave this false and see the camera as if rotation were 0.
   */
  rotated?: boolean;
  /** Additional rotation (radians, screen-clockwise in canvas space) about the focal point. Only honoured when `rotated`. */
  rotationDelta?: number;
}

/**
 * Mutators carry an intent so SplitLayout can pick the right autosave-flush
 * policy without reverse-inferring it from state (`isDirty()` post-hoc,
 * fitSize transition-direction, etc.). {@link adjustForUnfit} notifies with
 * intent `null` because it's a render-side scale fix-up, not a user action.
 */
export type CameraIntent = 'contentLoad' | 'restore' | 'userReset' | 'userRotate' | 'gesture';

/**
 * Camera-model view transform. State is stored as a viewing center in world
 * coordinates plus a zoom multiplier and a rotation — all container-independent — so a
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
 *
 * Rotation is "rotating the paper": only the drawing panel renders it (its
 * projection calls pass `rotated = true`); the reference viewers keep
 * projecting upright, so pan/zoom stay shared while the reference never
 * tilts. Home rotation is always 0.
 */
export class ViewTransform {
  private viewCenterX = 0;
  private viewCenterY = 0;
  private zoom = 1;
  /** Radians, normalized to (-π, π]. Positive = content turned clockwise on screen (canvas y-down). */
  private rotation = 0;
  private homeX = 0;
  private homeY = 0;
  private homeZoom = 1;
  private listeners = new Set<(intent: CameraIntent | null) => void>();

  /**
   * The active fitting viewer just loaded new content (image onload, video
   * mount, fixed-image swap, Fix Angle confirm). Register the content's
   * center as the new home and snap the camera there — any prior pan/zoom/rotation is
   * intentionally cleared. Emits intent `'contentLoad'`.
   */
  loadContent(centerX: number, centerY: number, zoom = 1): void {
    this.homeX = centerX;
    this.homeY = centerY;
    this.homeZoom = zoom;
    if (
      this.viewCenterX === centerX &&
      this.viewCenterY === centerY &&
      this.zoom === zoom &&
      this.rotation === 0
    ) {
      return;
    }
    this.viewCenterX = centerX;
    this.viewCenterY = centerY;
    this.zoom = zoom;
    this.rotation = 0;
    this.notify('contentLoad');
  }

  /** User clicked the reset-zoom button or pressed Cmd/Ctrl+0. Emits `'userReset'`. */
  userResetToHome(): void {
    if (this.isAtHomeInternal()) return;
    this.viewCenterX = this.homeX;
    this.viewCenterY = this.homeY;
    this.zoom = this.homeZoom;
    this.rotation = 0;
    this.notify('userReset');
  }

  /**
   * Restore a persisted camera (e.g. after page reload) without disturbing
   * the registered home. `zoom` is clamped to the same range as gestures;
   * `rotation` (radians, absent in pre-rotation drafts ≡ 0) is normalized.
   * Emits `'restore'` — SplitLayout's `suppressAutosaveRef` is up during the
   * restore window, so this intent does NOT trigger an immediate flush.
   */
  restoreCamera(viewCenterX: number, viewCenterY: number, zoom: number, rotation = 0): void {
    const clampedZoom = clampZoom(zoom);
    const normRotation = normalizeRotation(rotation);
    if (
      this.viewCenterX === viewCenterX &&
      this.viewCenterY === viewCenterY &&
      this.zoom === clampedZoom &&
      this.rotation === normRotation
    )
      return;
    this.viewCenterX = viewCenterX;
    this.viewCenterY = viewCenterY;
    this.zoom = clampedZoom;
    this.rotation = normRotation;
    this.notify('restore');
  }

  /**
   * Set the absolute rotation while keeping the world point under the
   * screen pivot `(pivotX, pivotY)` (rotated-frame screen coords of the
   * drawing panel) fixed. Used by the snap / reset animation and the
   * rotate-by-step keyboard shortcuts. `intent` is `'gesture'` for animation
   * frames (tail-debounced save) and `'userRotate'` for the discrete final
   * step (immediate save).
   */
  setRotationAbout(
    rotation: number,
    pivotX: number,
    pivotY: number,
    container: ContainerSize,
    baseScale: number,
    intent: 'gesture' | 'userRotate',
  ): void {
    const next = normalizeRotation(rotation);
    const scale = baseScale * this.zoom;
    if (scale <= 0) return;
    if (next === this.rotation) {
      // Still notify a discrete final step so a preceding animation's
      // tail-debounced save is promoted to an immediate one.
      if (intent === 'userRotate') this.notify(intent);
      return;
    }
    const pivotWorld = this.screenToCanvas(pivotX, pivotY, container, baseScale, true);
    this.rotation = next;
    this.placeWorldAt(pivotWorld, pivotX, pivotY, container, scale);
    this.notify(intent);
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
    return (
      this.viewCenterX === this.homeX &&
      this.viewCenterY === this.homeY &&
      this.zoom === this.homeZoom &&
      this.rotation === 0
    );
  }

  /**
   * Move `viewCenter` so that `world` lands at screen `(sx, sy)` under the
   * current rotation and the given absolute scale.
   */
  private placeWorldAt(
    world: Point,
    sx: number,
    sy: number,
    container: ContainerSize,
    scale: number,
  ): void {
    const dx = (sx - container.width / 2) / scale;
    const dy = (sy - container.height / 2) / scale;
    // Inverse-rotate the screen offset into world axes.
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    this.viewCenterX = world.x - (dx * cos + dy * sin);
    this.viewCenterY = world.y - (-dx * sin + dy * cos);
  }

  /**
   * Project the camera into a concrete (offsetX, offsetY, scale) transform
   * for a given canvas, ignoring rotation (upright panels — the reference
   * viewers). `baseScale` is the fit-to-container scale (or 1 for free
   * drawing); the absolute scale applied is `baseScale * zoom`.
   */
  project(container: ContainerSize, baseScale: number): Transform {
    const scale = baseScale * this.zoom;
    return {
      offsetX: container.width / 2 - this.viewCenterX * scale,
      offsetY: container.height / 2 - this.viewCenterY * scale,
      scale,
    };
  }

  /**
   * Full affine projection. With `rotated` the camera rotation is applied
   * about the container center (drawing panel); without it this is the
   * same transform as {@link project}.
   */
  projectMatrix(container: ContainerSize, baseScale: number, rotated = false): ProjectionMatrix {
    const scale = baseScale * this.zoom;
    const rot = rotated ? this.rotation : 0;
    const a = scale * Math.cos(rot);
    const b = scale * Math.sin(rot);
    const c = -b;
    const d = a;
    return {
      a,
      b,
      c,
      d,
      e: container.width / 2 - (a * this.viewCenterX + c * this.viewCenterY),
      f: container.height / 2 - (b * this.viewCenterX + d * this.viewCenterY),
      scale,
    };
  }

  screenToCanvas(
    screenX: number,
    screenY: number,
    container: ContainerSize,
    baseScale: number,
    rotated = false,
  ): Point {
    const scale = baseScale * this.zoom;
    const dx = (screenX - container.width / 2) / scale;
    const dy = (screenY - container.height / 2) / scale;
    if (!rotated || this.rotation === 0) {
      return { x: this.viewCenterX + dx, y: this.viewCenterY + dy };
    }
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    return {
      x: this.viewCenterX + dx * cos + dy * sin,
      y: this.viewCenterY - dx * sin + dy * cos,
    };
  }

  canvasToScreen(
    canvasX: number,
    canvasY: number,
    container: ContainerSize,
    baseScale: number,
    rotated = false,
  ): Point {
    const m = this.projectMatrix(container, baseScale, rotated);
    return {
      x: m.a * canvasX + m.c * canvasY + m.e,
      y: m.b * canvasX + m.d * canvasY + m.f,
    };
  }

  /**
   * Pinch zoom + pan (+ rotate) or wheel scroll. `(focalX, focalY)` is the
   * gesture focal point in canvas screen coords; `scaleDelta` is the
   * multiplicative zoom delta; `(panX, panY)` is an additional screen-space
   * translation applied after zoom; `opts.rotationDelta` turns the view about
   * the focal point (rotated panels only — see {@link GestureOptions}).
   * Container + baseScale are needed to resolve the focal world point. Emits
   * `'gesture'` — SplitLayout tail-debounces flush so one save fires per
   * gesture instead of per frame.
   */
  applyGesture(
    focalX: number,
    focalY: number,
    scaleDelta: number,
    panX: number,
    panY: number,
    container: ContainerSize,
    baseScale: number,
    opts: GestureOptions = {},
  ): void {
    const rotated = opts.rotated ?? false;
    const rotationDelta = rotated ? (opts.rotationDelta ?? 0) : 0;
    if (scaleDelta === 1 && panX === 0 && panY === 0 && rotationDelta === 0) return;
    const oldScale = baseScale * this.zoom;
    if (oldScale <= 0) return;

    // World point at the focal screen point before the gesture, resolved in
    // the frame the caller renders in: upright callers (`rotated` false)
    // resolve it as if rotation were 0 even while the drawing panel is turned.
    const focalWorld = this.screenToCanvas(focalX, focalY, container, baseScale, rotated);

    const newZoom = clampZoom(this.zoom * scaleDelta);
    const newScale = baseScale * newZoom;

    // After the gesture we want the focal world point to land at
    // (focalX + panX, focalY + panY) in screen space — i.e. the gesture's
    // focal point follows the user's fingers.
    const targetX = focalX + panX;
    const targetY = focalY + panY;
    this.zoom = newZoom;
    if (rotated) {
      this.rotation = normalizeRotation(this.rotation + rotationDelta);
      this.placeWorldAt(focalWorld, targetX, targetY, container, newScale);
    } else {
      this.viewCenterX = focalWorld.x - (targetX - container.width / 2) / newScale;
      this.viewCenterY = focalWorld.y - (targetY - container.height / 2) / newScale;
    }
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

  /** Current rotation in radians, normalized to (-π, π]. */
  getRotation(): number {
    return this.rotation;
  }

  /** Camera state snapshot — useful for serialization or UI inspection. */
  getCamera(): { viewCenterX: number; viewCenterY: number; zoom: number; rotation: number } {
    return {
      viewCenterX: this.viewCenterX,
      viewCenterY: this.viewCenterY,
      zoom: this.zoom,
      rotation: this.rotation,
    };
  }

  /**
   * Subscribe to camera changes. The listener receives the {@link CameraIntent}
   * that drove the change, or `null` for render-side adjustments
   * ({@link adjustForUnfit}) that should not trigger user-intent handling.
   * Listeners that only care about repainting can ignore the argument.
   */
  subscribe(listener: (intent: CameraIntent | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(intent: CameraIntent | null): void {
    for (const listener of this.listeners) listener(intent);
  }
}
