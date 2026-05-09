import type { Point, Stroke } from './types';

const QUANTIZE_FACTOR = 10;

/**
 * Round half away from zero so positive and negative coordinates quantize
 * symmetrically around the origin. Math.round biases toward +Infinity at exact
 * halves (Math.round(0.5) === 1, Math.round(-0.5) === 0), which would shift
 * strokes toward the origin asymmetrically once world coords can be negative.
 */
function quantize(v: number): number {
  const sign = v < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(v) * QUANTIZE_FACTOR) / QUANTIZE_FACTOR;
}

export function quantizePoint(p: Point): Point {
  return { x: quantize(p.x), y: quantize(p.y) };
}

/**
 * Snap a stroke to the 0.1px grid and drop points that collapse onto the
 * previous point after quantization. Shape is preserved (no RDP-style
 * approximation). Idempotent: re-running on already-quantized input is a no-op.
 */
export function quantizeStroke(stroke: Stroke): Stroke {
  const out: Point[] = [];
  let prevX = NaN;
  let prevY = NaN;
  for (const p of stroke.points) {
    const x = quantize(p.x);
    const y = quantize(p.y);
    if (x === prevX && y === prevY) continue;
    out.push({ x, y });
    prevX = x;
    prevY = y;
  }
  return { points: out, timestamp: stroke.timestamp };
}
