/**
 * Pure helpers for the drawing-panel "rotate the paper" feature (pinch
 * rotation, snap, keyboard steps, indicator readout). The camera state
 * itself lives in {@link ViewTransform}; this module only decides angles.
 *
 * Convention: radians, normalized to (-π, π], positive = clockwise in canvas
 * space (y-down). The drawing panel's horizontal flip mirrors the canvas via
 * CSS, so a canvas-space rotation reads as the opposite direction on screen —
 * callers that deal in *screen* directions (finger angle, ←/→ keys, the
 * degree readout) convert with {@link screenToCanvasRotation}.
 */
import { normalizeRotation } from './ViewTransform';

const DEG = Math.PI / 180;

/** Finger twist (cumulative, per pinch) before a pinch starts rotating. Keeps zoom-only pinches from tilting the paper. */
export const PINCH_ROTATE_START_THRESHOLD = 10 * DEG;
/** Snap targets on release: every 90°. */
export const ROTATION_SNAP_STEP = 90 * DEG;
/** Release within this of a snap target and the view settles onto it. */
export const ROTATION_SNAP_TOLERANCE = 5 * DEG;
/** Keyboard rotate step (Krita's 4 / 6 default). */
export const ROTATION_KEY_STEP = 15 * DEG;
/** Duration of the snap / reset / key-step rotation animation. */
export const ROTATION_ANIM_MS = 180;

/** Signed shortest angular distance from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeRotation(to - from);
}

/**
 * The snap target for a release at `rotation`, or null when it's not within
 * {@link ROTATION_SNAP_TOLERANCE} of a multiple of {@link ROTATION_SNAP_STEP}.
 */
export function snapRotationTarget(rotation: number): number | null {
  const k = Math.round(rotation / ROTATION_SNAP_STEP);
  const target = normalizeRotation(k * ROTATION_SNAP_STEP);
  return Math.abs(shortestAngleDelta(rotation, target)) <= ROTATION_SNAP_TOLERANCE ? target : null;
}

/**
 * Next keyboard step from `rotation` in canvas direction `dir` (+1 = canvas
 * clockwise). Lands on the 15° grid (23° → 30° / 15°) rather than adding a
 * flat 15°, so repeated presses can always get back to exactly upright.
 */
export function nextRotationStep(rotation: number, dir: 1 | -1): number {
  const steps = rotation / ROTATION_KEY_STEP;
  // Tolerance so a value sitting on the grid (modulo float noise) moves a full step.
  const eps = 1e-6;
  const k = dir > 0 ? Math.floor(steps + eps) + 1 : Math.ceil(steps - eps) - 1;
  return normalizeRotation(k * ROTATION_KEY_STEP);
}

/** Convert a screen-direction rotation (as the user sees it) to canvas direction. */
export function screenToCanvasRotation(rotation: number, flipped: boolean): number {
  return flipped ? -rotation : rotation;
}

/** Rotation as the user sees it on screen, in whole degrees (−179…180). */
export function displayRotationDegrees(rotation: number, flipped: boolean): number {
  const deg = Math.round(normalizeRotation(screenToCanvasRotation(rotation, flipped)) / DEG);
  if (deg === -180) return 180;
  return deg === 0 ? 0 : deg;
}

/** True when the rotation is an exact multiple of 90° (a snap position). */
export function isRightAngleRotation(rotation: number): boolean {
  const k = Math.round(rotation / ROTATION_SNAP_STEP);
  return Math.abs(rotation - k * ROTATION_SNAP_STEP) < 1e-9;
}
