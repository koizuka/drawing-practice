import { STROKE_WIDTH } from '../drawing/constants';
import type { Stroke } from '../drawing/types';
import { canvasToBlob } from '../utils/imageResize';
import type { DrawingRecord } from './db';

export type ExportFormat = 'svg' | 'png' | 'jpeg';

const RASTER_TARGET_LONG_EDGE = 2048;
const RASTER_MAX_SCALE = 4;
// 8 Mpx stays under iOS Safari's ~16 Mpx canvas decode ceiling and keeps
// JPEG/PNG encode allocations bounded for very large reference drawings.
const RASTER_MAX_PIXELS = 8_000_000;
const JPEG_QUALITY = 0.92;
const TITLE_MAX_LEN = 50;
const FALLBACK_DIMENSION = 1;
const PADDING_RATIO = 0.05;
const PADDING_MIN = 20;
// Hold the object URL long enough that the browser can start the download
// even on slow devices; the URL is released after roughly a minute.
const REVOKE_DELAY_MS = 60_000;

interface BoundingBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function computeStrokesBoundingBox(strokes: readonly Stroke[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: FALLBACK_DIMENSION, height: FALLBACK_DIMENSION };
  }
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, FALLBACK_DIMENSION),
    height: Math.max(maxY - minY, FALLBACK_DIMENSION),
  };
}

export function paddedBox(box: BoundingBox): { x: number; y: number; width: number; height: number; padding: number } {
  const padding = Math.max(PADDING_MIN, Math.max(box.width, box.height) * PADDING_RATIO);
  return {
    x: box.minX - padding,
    y: box.minY - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    padding,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

const UNSAFE_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

export function sanitizeTitle(title: string): string {
  if (!title) return '';
  // Whitespace -> '-' first so tabs (which are also control chars) survive
  // the next strip pass as a hyphen instead of being silently dropped.
  let out = title.replace(/\s+/g, '-');
  let stripped = '';
  for (const ch of out) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if (UNSAFE_CHARS.has(ch)) continue;
    stripped += ch;
  }
  out = stripped;
  out = out.replace(/-+/g, '-');
  out = out.replace(/^[-.]+|[-.]+$/g, '');
  // CJK characters are kept (modern OSes/browsers handle UTF-8 filenames fine).
  if (out.length > TITLE_MAX_LEN) out = out.slice(0, TITLE_MAX_LEN).replace(/-+$/, '');
  return out;
}

export function buildExportFilename(drawing: DrawingRecord, format: ExportFormat): string {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const ts = formatTimestamp(new Date(drawing.createdAt));
  const title = sanitizeTitle(drawing.reference?.title ?? '');
  const titlePart = title ? `-${title}` : '';
  return `drawing-practice-${ts}${titlePart}.${ext}`;
}

function formatNum(n: number): string {
  // Stored stroke coordinates are quantized to 0.1px; 2 decimals is plenty.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function pointsToPathData(stroke: Stroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const head = `M${formatNum(pts[0].x)} ${formatNum(pts[0].y)}`;
  if (pts.length === 1) {
    // Zero-length segment renders as a dot via stroke-linecap="round".
    return `${head} L${formatNum(pts[0].x)} ${formatNum(pts[0].y)}`;
  }
  let body = '';
  for (let i = 1; i < pts.length; i++) {
    body += ` L${formatNum(pts[i].x)} ${formatNum(pts[i].y)}`;
  }
  return head + body;
}

export function exportDrawingAsSvg(drawing: DrawingRecord): Blob {
  const box = paddedBox(computeStrokesBoundingBox(drawing.strokes));
  const viewBox = `${formatNum(box.x)} ${formatNum(box.y)} ${formatNum(box.width)} ${formatNum(box.height)}`;
  let paths = '';
  for (const s of drawing.strokes) {
    const d = pointsToPathData(s);
    if (d.length > 0) paths += `<path d="${d}"/>`;
  }
  const svg
    = `<?xml version="1.0" encoding="UTF-8"?>`
      + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${formatNum(box.width)}" height="${formatNum(box.height)}">`
      + `<rect x="${formatNum(box.x)}" y="${formatNum(box.y)}" width="${formatNum(box.width)}" height="${formatNum(box.height)}" fill="#ffffff"/>`
      + `<g fill="none" stroke="#000000" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
      + `</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function rasterScale(boxWidth: number, boxHeight: number): number {
  const longEdge = Math.max(boxWidth, boxHeight);
  const targetScale = Math.max(1, RASTER_TARGET_LONG_EDGE / longEdge);
  // Cap by both edge length and total pixels so wide-aspect huge drawings
  // still respect RASTER_MAX_PIXELS.
  const pixelCapScale = Math.sqrt(RASTER_MAX_PIXELS / (boxWidth * boxHeight));
  return Math.min(RASTER_MAX_SCALE, targetScale, pixelCapScale);
}

function renderToCanvas(drawing: DrawingRecord): HTMLCanvasElement {
  const box = paddedBox(computeStrokesBoundingBox(drawing.strokes));
  const scale = rasterScale(box.width, box.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D rendering context');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of drawing.strokes) {
    const pts = stroke.points;
    if (pts.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x, pts[0].y);
    }
    else {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  return canvas;
}

async function exportDrawingAsPng(drawing: DrawingRecord): Promise<Blob> {
  return canvasToBlob(renderToCanvas(drawing), 'image/png');
}

async function exportDrawingAsJpeg(drawing: DrawingRecord): Promise<Blob> {
  return canvasToBlob(renderToCanvas(drawing), 'image/jpeg', JPEG_QUALITY);
}

const EXPORTERS: Record<ExportFormat, (d: DrawingRecord) => Blob | Promise<Blob>> = {
  svg: exportDrawingAsSvg,
  png: exportDrawingAsPng,
  jpeg: exportDrawingAsJpeg,
};

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export async function exportDrawing(drawing: DrawingRecord, format: ExportFormat): Promise<void> {
  const blob = await EXPORTERS[format](drawing);
  triggerDownload(blob, buildExportFilename(drawing, format));
}
