import { describe, expect, it } from 'vitest';
import {
  animationBox,
  animationExportFilename,
  animationSourceFromRecord,
  buildQuantizer,
  contactSheetColumns,
  frameRenderItems,
  isAnimatedDrawing,
} from './exportAnimation';
import type { DrawingRecord } from './db';
import type { Stroke } from '../drawing/types';
import type { Layer } from '../drawing/layers';

const s = (x: number, frameId?: string, layerId?: string): Stroke => ({
  points: [
    { x, y: 0 },
    { x: x + 10, y: 10 },
  ],
  timestamp: 0,
  ...(frameId ? { frameId } : {}),
  ...(layerId ? { layerId } : {}),
});

describe('buildQuantizer', () => {
  it('maps white, pure tints and blends onto the right ramp', () => {
    const q = buildQuantizer(['#000000', '#2f6fdf', '#000000']);
    expect(q.palette[0]).toBe(0xffffff);
    expect(q.palette.length).toBeLessThanOrEqual(256);
    expect(q.indexOf(255, 255, 255)).toBe(0);
    expect(q.palette[q.indexOf(0, 0, 0)]).toBe(0x000000);
    expect(q.palette[q.indexOf(0x2f, 0x6f, 0xdf)]).toBe(0x2f6fdf);
    // 50% gray stays gray (not tinted blue).
    const gray = q.palette[q.indexOf(128, 128, 128)];
    const [r, g, b] = [(gray >> 16) & 255, (gray >> 8) & 255, gray & 255];
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(Math.abs(r - 128)).toBeLessThan(5);
    // Half-opacity blue lands on the blue ramp.
    const half = q.palette[q.indexOf(151, 183, 239)];
    expect((half & 255) > ((half >> 16) & 255)).toBe(true);
  });

  it('falls back to black when no colors are given', () => {
    const q = buildQuantizer([]);
    expect(q.palette[q.indexOf(0, 0, 0)]).toBe(0);
  });
});

describe('contactSheetColumns', () => {
  it('aims for a landscape sheet', () => {
    expect(contactSheetColumns(1, 400, 300)).toBe(1);
    expect(contactSheetColumns(12, 400, 300)).toBe(4);
    // Tall cells → more columns.
    expect(contactSheetColumns(12, 200, 400)).toBeGreaterThan(4);
  });
});

describe('frame rendering helpers', () => {
  const layers: Layer[] = [
    { id: 'base', name: 'A', visible: true, opacity: 1, locked: false, color: 'ink' },
    { id: 'bg', name: 'B', visible: true, opacity: 1, locked: false, color: 'blue', shared: true },
    { id: 'hid', name: 'C', visible: false, opacity: 1, locked: false, color: 'ink' },
  ];
  const strokes = [
    s(0),
    s(100, 'frame-1'),
    s(-50, 'shared', 'bg'),
    s(1000, 'frame-1', 'hid'), // hidden: must not widen the box
  ];
  const src = { strokes, layers, frames: ['frame-0', 'frame-1'], fps: 8 };

  it('renders each frame plus shared layers, skipping hidden ones', () => {
    const per = frameRenderItems(src);
    expect(per.map((items) => items.map((it) => it.stroke.points[0].x))).toEqual([
      [0, -50],
      [100, -50],
    ]);
  });

  it('uses one box over every frame', () => {
    const box = animationBox(frameRenderItems(src));
    expect(box.x).toBeLessThan(-50);
    expect(box.x + box.width).toBeGreaterThan(110);
    expect(box.x + box.width).toBeLessThan(1000);
  });
});

describe('record helpers', () => {
  const base = { createdAt: new Date(0), strokes: [] } as unknown as DrawingRecord;

  it('detects animated records', () => {
    expect(isAnimatedDrawing(base)).toBe(false);
    expect(isAnimatedDrawing({ frames: ['frame-0'] })).toBe(false);
    expect(isAnimatedDrawing({ frames: ['frame-0', 'frame-1'] })).toBe(true);
  });

  it('fills defaults for single-frame records', () => {
    expect(animationSourceFromRecord(base)).toMatchObject({ frames: ['frame-0'], fps: 8 });
    expect(
      animationSourceFromRecord({ ...base, frames: ['frame-0', 'frame-3'], fps: 12 }),
    ).toMatchObject({ frames: ['frame-0', 'frame-3'], fps: 12 });
    // Corrupt fps / duplicate frames are sanitized like an editor load.
    expect(
      animationSourceFromRecord({ ...base, frames: ['frame-0', 'frame-0', 'frame-2'], fps: 0 }),
    ).toMatchObject({ frames: ['frame-0', 'frame-2'], fps: 8 });
  });

  it('names files by kind', () => {
    expect(animationExportFilename('x', 'gif')).toBe('x-anim.gif');
    expect(animationExportFilename('x', 'sheet')).toBe('x-sheet.png');
  });
});
