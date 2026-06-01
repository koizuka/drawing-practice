/**
 * Pure decision logic for the Apple Pencil input-freeze hint
 * (see docs/apple-pencil-input-freeze.md and DrawingFreezeHint.tsx). Split out
 * of the component file so it can be unit-tested and so the component module
 * only exports components (react-refresh).
 */

// Continuous-draw streak floor before the hint can show. Observed freezes
// needed 150s+ of sustained drawing; sessions ≤60s never froze. A high floor
// keeps casual pauses after short drawing from ever triggering it.
export const STREAK_MS = 60_000;
// Input silence before the hint appears (recovery needs ~2s idle anyway).
export const SILENCE_MS = 2_500;
// How long to keep the hint up within one silence episode, then auto-hide.
export const MAX_VISIBLE_MS = 8_000;

// Anchor clamp estimates (CSS px) so the pill stays on-screen near edges. The
// pill is centered above the anchor (translate(-50%, -100%)), so reserve about
// half its width on each side and its height above. EST_HALF_W is exported so
// the component can derive the pill's maxWidth from it (keeps the clamp reserve
// and the rendered width in sync).
export const EST_HALF_W = 120;
const EST_ABOVE = 52;
const MARGIN = 8;

export const DEFAULT_THRESHOLDS: FreezeHintThresholds = {
  streakMs: STREAK_MS,
  silenceMs: SILENCE_MS,
  maxVisibleMs: MAX_VISIBLE_MS,
};

export interface FreezeHintThresholds {
  streakMs: number;
  silenceMs: number;
  maxVisibleMs: number;
}

export interface FreezeHintInput {
  /** performance.now() of the last touch. */
  lastInputAt: number;
  /** performance.now() when the current continuous-draw streak began. */
  streakStartAt: number;
  /** Last touch position in viewport (client) px, or null if none yet. */
  client: { x: number; y: number } | null;
  /** The drawing container's bounding rect, or null if unmeasurable. */
  containerRect: { left: number; top: number; width: number; height: number } | null;
}

export interface FreezeHintResult {
  visible: boolean;
  /** Anchor position in container-relative CSS px (only meaningful if visible). */
  x: number;
  y: number;
}

// Clamp v into [lo, hi]; if the range is empty (container too small to honor
// the reserve on both sides), fall back to `mid` so the pill stays centered
// rather than pinned to one edge (which would overflow the opposite side).
function clampOrCenter(v: number, lo: number, hi: number, mid: number): number {
  if (hi < lo) return mid;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The time-only gate: a long enough continuous-draw streak, then input silence
 * inside the show-window. Cheap (number reads only, no DOM), so the component
 * can call it first and skip the layout read (getBoundingClientRect) on the
 * common ticks where the hint can't be shown.
 */
export function isFreezeHintEligible(
  lastInputAt: number,
  streakStartAt: number,
  now: number,
  th: FreezeHintThresholds = DEFAULT_THRESHOLDS,
): boolean {
  const silence = now - lastInputAt;
  const streak = lastInputAt - streakStartAt;
  return streak >= th.streakMs && silence >= th.silenceMs && silence < th.silenceMs + th.maxVisibleMs;
}

/**
 * Pure freeze-hint decision: given the input-tracking snapshot and the current
 * time, decide whether the "lift your pen" hint should show and where.
 */
export function evaluateFreezeHint(
  input: FreezeHintInput,
  now: number,
  th: FreezeHintThresholds = DEFAULT_THRESHOLDS,
): FreezeHintResult {
  const { lastInputAt, streakStartAt, client, containerRect } = input;
  const visible
    = client != null
      && containerRect != null
      && isFreezeHintEligible(lastInputAt, streakStartAt, now, th);

  if (!visible) return { visible: false, x: 0, y: 0 };

  const relX = client.x - containerRect.left;
  const relY = client.y - containerRect.top;
  const x = clampOrCenter(relX, EST_HALF_W + MARGIN, containerRect.width - EST_HALF_W - MARGIN, containerRect.width / 2);
  const y = clampOrCenter(relY, EST_ABOVE + MARGIN, containerRect.height - MARGIN, containerRect.height / 2);
  return { visible: true, x, y };
}
