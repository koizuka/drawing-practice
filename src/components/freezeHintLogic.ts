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
// half its width on each side and its height above.
const EST_HALF_W = 120;
const EST_ABOVE = 52;
const MARGIN = 8;

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

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pure freeze-hint decision: given the input-tracking snapshot and the current
 * time, decide whether the "lift your pen" hint should show and where.
 */
export function evaluateFreezeHint(
  input: FreezeHintInput,
  now: number,
  th: FreezeHintThresholds = { streakMs: STREAK_MS, silenceMs: SILENCE_MS, maxVisibleMs: MAX_VISIBLE_MS },
): FreezeHintResult {
  const { lastInputAt, streakStartAt, client, containerRect } = input;
  const silence = now - lastInputAt;
  const streak = lastInputAt - streakStartAt;
  const visible
    = client != null
      && containerRect != null
      && streak >= th.streakMs
      && silence >= th.silenceMs
      && silence < th.silenceMs + th.maxVisibleMs;

  if (!visible) return { visible: false, x: 0, y: 0 };

  const relX = client.x - containerRect.left;
  const relY = client.y - containerRect.top;
  const x = clamp(relX, EST_HALF_W + MARGIN, containerRect.width - EST_HALF_W - MARGIN);
  const y = clamp(relY, EST_ABOVE + MARGIN, containerRect.height - MARGIN);
  return { visible: true, x, y };
}
