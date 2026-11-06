import { STROKE_WIDTH } from '../drawing/constants';
import { DEFAULT_FPS, DEFAULT_FRAME_ID } from '../drawing/frames';
import { renderItemsForStoredDrawing, type Layer, type StrokeRenderItem } from '../drawing/layers';
import type { StoredDocFields } from '../drawing/docState';
import type { Stroke } from '../drawing/types';
import { encodeGif, frameDelaysCs, type GifFrame } from '../utils/gifEncoder';
import { canvasToBlob } from '../utils/imageResize';
import type { DrawingRecord } from './db';
import {
  computeStrokesBoundingBox,
  drawRenderItems,
  exportFilenameStem,
  paddedBox,
  triggerDownload,
} from './exportDrawing';

/**
 * Animation exports (docs/layers.md "Phase 3"): an animated GIF and a
 * contact sheet (コマ割りシート — every frame in a numbered grid, one PNG).
 *
 * Both render every frame with the same visible-layer rules as the still
 * exports (`renderItemsForStoredDrawing`) over ONE world box shared by all
 * frames, so a moving line moves in the output instead of being re-centered
 * frame by frame.
 */

export type AnimationExportKind = 'gif' | 'sheet';

export interface AnimationSource {
  strokes: readonly Stroke[];
  layers?: readonly Layer[];
  /** Frame ids in playback order. */
  frames: readonly string[];
  fps: number;
}

// GIF frames are full-size images times the frame count, so they stay far
// smaller than the 2048px still export.
const GIF_TARGET_LONG_EDGE = 720;
const GIF_MAX_SCALE = 2;
// Thinner than this the 1-unit stroke turns into a pale antialiased smear.
const MIN_LINE_PX = 1.25;

const SHEET_CELL_LONG_EDGE = 480;
const SHEET_MAX_SCALE = 2;
const SHEET_MAX_PIXELS = 8_000_000; // same ceiling as the still raster export
const SHEET_MARGIN = 24;
const SHEET_GAP = 12;
const SHEET_LABEL_PX = 14;
/** Sheet shape the column count aims for (landscape, roughly A-series). */
const SHEET_TARGET_ASPECT = Math.SQRT2;

const WHITE = 0xffffff;

/** True for stored drawings worth an animation export (more than one frame). */
export function isAnimatedDrawing(d: StoredDocFields): boolean {
  return (d.frames?.length ?? 0) > 1;
}

export function animationSourceFromRecord(d: DrawingRecord): AnimationSource {
  return {
    strokes: d.strokes,
    layers: d.layers,
    frames: d.frames && d.frames.length > 0 ? d.frames : [DEFAULT_FRAME_ID],
    fps: d.fps ?? DEFAULT_FPS,
  };
}

/** Render items for every frame, in playback order. */
export function frameRenderItems(src: AnimationSource): StrokeRenderItem[][] {
  return src.frames.map((frameId) =>
    renderItemsForStoredDrawing(src.strokes, src.layers, { frames: src.frames, frameId }),
  );
}

/** Padded world box covering every frame. */
export function animationBox(perFrame: readonly StrokeRenderItem[][]) {
  return paddedBox(computeStrokesBoundingBox(perFrame.flat().map((it) => it.stroke)));
}

function parseHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  return m ? parseInt(m[1], 16) : 0;
}

export interface Quantizer {
  /** 0xRRGGBB entries; index 0 is always white. */
  palette: number[];
  indexOf(r: number, g: number, b: number): number;
}

/**
 * Palette + nearest-color lookup for line art on white.
 *
 * Every pixel of an export is white, a stroke color, or (antialiasing, layer
 * opacity) a blend between white and one stroke color. So instead of a
 * generic median-cut, the palette is a white→color ramp per stroke color and
 * each pixel is projected onto the closest ramp. Pixels where two colors
 * overlap snap to the nearer ramp — invisible at line-art scale.
 */
export function buildQuantizer(colors: readonly string[]): Quantizer {
  const tints: [number, number, number][] = [];
  const seen = new Set<number>();
  for (const hex of colors) {
    const c = parseHex(hex);
    if (c === WHITE || seen.has(c)) continue;
    seen.add(c);
    tints.push([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
  }
  if (tints.length === 0) tints.push([0, 0, 0]);
  const levels = Math.max(1, Math.min(64, Math.floor(255 / tints.length)));

  const palette = [WHITE];
  for (const [r, g, b] of tints) {
    for (let l = 1; l <= levels; l++) {
      const t = l / levels;
      const pr = Math.round(255 + (r - 255) * t);
      const pg = Math.round(255 + (g - 255) * t);
      const pb = Math.round(255 + (b - 255) * t);
      palette.push((pr << 16) | (pg << 8) | pb);
    }
  }

  const cache = new Map<number, number>();
  const indexOf = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    if (key === WHITE) return 0;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // Distance from white, projected onto each white→tint direction.
    const qr = 255 - r,
      qg = 255 - g,
      qb = 255 - b;
    let best = 0;
    let bestErr = Infinity;
    for (let ci = 0; ci < tints.length; ci++) {
      const [tr, tg, tb] = tints[ci];
      const dr = 255 - tr,
        dg = 255 - tg,
        db = 255 - tb;
      const dd = dr * dr + dg * dg + db * db;
      const t = Math.max(0, Math.min(1, (qr * dr + qg * dg + qb * db) / dd));
      const er = qr - t * dr,
        eg = qg - t * dg,
        eb = qb - t * db;
      const err = er * er + eg * eg + eb * eb;
      if (err < bestErr) {
        bestErr = err;
        const level = Math.round(t * levels);
        best = level === 0 ? 0 : 1 + ci * levels + (level - 1);
      }
    }
    cache.set(key, best);
    return best;
  };
  return { palette, indexOf };
}

function usedColors(perFrame: readonly StrokeRenderItem[][]): string[] {
  const set = new Set<string>();
  for (const items of perFrame) for (const it of items) set.add(it.color);
  return [...set];
}

/** World→pixel scale for a `w`×`h` world box aiming at `longEdge` pixels. */
function fitScale(w: number, h: number, longEdge: number, maxScale: number): number {
  return Math.min(maxScale, longEdge / Math.max(w, h));
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  items: readonly StrokeRenderItem[],
  box: { x: number; y: number },
  scale: number,
  originX = 0,
  originY = 0,
): void {
  ctx.setTransform(scale, 0, 0, scale, originX - box.x * scale, originY - box.y * scale);
  drawRenderItems(ctx, items, Math.max(STROKE_WIDTH, MIN_LINE_PX / scale));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Encode every frame as one looping GIF at `src.fps`. */
export async function renderAnimationGif(src: AnimationSource): Promise<Blob> {
  const perFrame = frameRenderItems(src);
  const box = animationBox(perFrame);
  const scale = fitScale(box.width, box.height, GIF_TARGET_LONG_EDGE, GIF_MAX_SCALE);
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to acquire 2D rendering context');

  const q = buildQuantizer(usedColors(perFrame));
  const delays = frameDelaysCs(perFrame.length, src.fps);
  const frames: GifFrame[] = [];
  for (let f = 0; f < perFrame.length; f++) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    paintFrame(ctx, perFrame[f], box, scale);
    const data = ctx.getImageData(0, 0, width, height).data;
    const indices = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
      indices[i] = q.indexOf(data[p], data[p + 1], data[p + 2]);
    }
    frames.push({ indices, delayCs: delays[f] });
    // Up to 120 frames: let the UI breathe between them.
    await yieldToUi();
  }
  const bytes = encodeGif({ width, height, palette: q.palette, frames });
  return new Blob([bytes as BlobPart], { type: 'image/gif' });
}

/**
 * Column count for `n` cells of `cellW`×`cellH` (+ gap) whose sheet comes
 * closest to SHEET_TARGET_ASPECT.
 */
export function contactSheetColumns(n: number, cellW: number, cellH: number): number {
  let best = 1;
  let bestDiff = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (cols * (cellW + SHEET_GAP)) / (rows * (cellH + SHEET_GAP));
    const diff = Math.abs(Math.log(aspect / SHEET_TARGET_ASPECT));
    if (diff < bestDiff - 1e-9) {
      bestDiff = diff;
      best = cols;
    }
  }
  return best;
}

/** Every frame in a numbered grid on one white canvas. */
export function renderContactSheet(src: AnimationSource): HTMLCanvasElement {
  const perFrame = frameRenderItems(src);
  const box = animationBox(perFrame);
  const n = perFrame.length;
  let scale = fitScale(box.width, box.height, SHEET_CELL_LONG_EDGE, SHEET_MAX_SCALE);
  const cols = contactSheetColumns(n, box.width * scale, box.height * scale);
  const rows = Math.ceil(n / cols);
  // Shrink cells until the whole sheet fits the raster pixel ceiling.
  const sheetSize = (s: number) => {
    const cw = Math.max(1, Math.round(box.width * s));
    const ch = Math.max(1, Math.round(box.height * s));
    const labelH = SHEET_LABEL_PX + 6;
    return {
      cw,
      ch,
      labelH,
      w: SHEET_MARGIN * 2 + cols * cw + (cols - 1) * SHEET_GAP,
      h: SHEET_MARGIN * 2 + rows * (ch + labelH) + (rows - 1) * SHEET_GAP,
    };
  };
  let size = sheetSize(scale);
  if (size.w * size.h > SHEET_MAX_PIXELS) {
    scale *= Math.sqrt(SHEET_MAX_PIXELS / (size.w * size.h));
    size = sheetSize(scale);
    while (size.w * size.h > SHEET_MAX_PIXELS && scale > 0.01) {
      scale *= 0.95;
      size = sheetSize(scale);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D rendering context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.w, size.h);

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = SHEET_MARGIN + col * (size.cw + SHEET_GAP);
    const y = SHEET_MARGIN + row * (size.ch + size.labelH + SHEET_GAP);
    ctx.fillStyle = '#666666';
    ctx.font = `${SHEET_LABEL_PX}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x, y);
    const cy = y + size.labelH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, cy, size.cw, size.ch);
    ctx.clip();
    paintFrame(ctx, perFrame[i], box, scale, x, cy);
    ctx.restore();
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, cy - 0.5, size.cw + 1, size.ch + 1);
  }
  return canvas;
}

export async function renderAnimationExport(
  src: AnimationSource,
  kind: AnimationExportKind,
): Promise<Blob> {
  return kind === 'gif'
    ? renderAnimationGif(src)
    : canvasToBlob(renderContactSheet(src), 'image/png');
}

export function animationExportFilename(stem: string, kind: AnimationExportKind): string {
  return kind === 'gif' ? `${stem}-anim.gif` : `${stem}-sheet.png`;
}

/** Export a saved gallery drawing. */
export async function exportDrawingAnimation(
  drawing: DrawingRecord,
  kind: AnimationExportKind,
): Promise<void> {
  const blob = await renderAnimationExport(animationSourceFromRecord(drawing), kind);
  triggerDownload(blob, animationExportFilename(exportFilenameStem(drawing), kind));
}

/** Export the drawing being edited (not necessarily saved), named by "now". */
export async function exportLiveAnimation(
  src: AnimationSource,
  kind: AnimationExportKind,
): Promise<void> {
  const blob = await renderAnimationExport(src, kind);
  triggerDownload(
    blob,
    animationExportFilename(exportFilenameStem({ createdAt: new Date() }), kind),
  );
}
