import { describe, it, expect, vi } from 'vitest';
import { quantizeStrokesForStorage } from './drawingStore';
import type { Stroke } from '../drawing/types';

describe('quantizeStrokesForStorage', () => {
  it('rounds coordinates to 0.1px', () => {
    const input: Stroke[] = [
      {
        points: [
          { x: 12.34567, y: 23.45678 },
          { x: 99.96, y: 50.01 },
        ],
        timestamp: 1000,
      },
    ];
    const out = quantizeStrokesForStorage(input);
    expect(out).toEqual([
      {
        points: [
          { x: 12.3, y: 23.5 },
          { x: 100, y: 50 },
        ],
        timestamp: 1000,
      },
    ]);
  });

  it('drops points that collapse onto the previous point after quantization', () => {
    const input: Stroke[] = [
      {
        points: [
          { x: 12.34, y: 23.45 },
          { x: 12.32, y: 23.46 },
          { x: 12.3, y: 23.49 },
          { x: 80, y: 80 },
        ],
        timestamp: 0,
      },
    ];
    const out = quantizeStrokesForStorage(input);
    expect(out[0].points).toEqual([
      { x: 12.3, y: 23.5 },
      { x: 80, y: 80 },
    ]);
  });

  it('preserves shape across multiple strokes independently', () => {
    const input: Stroke[] = [
      { points: [{ x: 1.111, y: 2.222 }], timestamp: 1 },
      {
        points: [
          { x: 3.333, y: 4.444 },
          { x: 5.555, y: 6.666 },
        ],
        timestamp: 2,
      },
    ];
    const out = quantizeStrokesForStorage(input);
    expect(out).toEqual([
      { points: [{ x: 1.1, y: 2.2 }], timestamp: 1 },
      {
        points: [
          { x: 3.3, y: 4.4 },
          { x: 5.6, y: 6.7 },
        ],
        timestamp: 2,
      },
    ]);
  });

  it('handles empty stroke list', () => {
    expect(quantizeStrokesForStorage([])).toEqual([]);
  });

  it('keeps a single-point stroke', () => {
    const input: Stroke[] = [{ points: [{ x: 5.55, y: 6.66 }], timestamp: 7 }];
    expect(quantizeStrokesForStorage(input)).toEqual([
      { points: [{ x: 5.6, y: 6.7 }], timestamp: 7 },
    ]);
  });

  it('is idempotent for already-quantized input', () => {
    const input: Stroke[] = [
      {
        points: [
          { x: 12.3, y: 23.5 },
          { x: 80, y: 80 },
          { x: -0.1, y: 0.1 },
        ],
        timestamp: 1,
      },
    ];
    const once = quantizeStrokesForStorage(input);
    const twice = quantizeStrokesForStorage(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input strokes', () => {
    const input: Stroke[] = [
      {
        points: [{ x: 1.234, y: 5.678 }],
        timestamp: 42,
      },
    ];
    const snapshot = JSON.stringify(input);
    quantizeStrokesForStorage(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  // World coordinates can be negative under the center-origin convention. JS
  // Math.round biases to +Infinity at exact halves (Math.round(-0.5) === 0),
  // which would skew points just below an origin-line away from the line.
  // Symmetric (half-away-from-zero) rounding fixes this.
  it('quantizes negative coordinates symmetrically with positive ones', () => {
    const input: Stroke[] = [
      {
        points: [
          { x: -12.34567, y: -23.45678 },
          { x: 12.34567, y: 23.45678 },
        ],
        timestamp: 1,
      },
    ];
    const out = quantizeStrokesForStorage(input);
    expect(out[0].points).toEqual([
      { x: -12.3, y: -23.5 },
      { x: 12.3, y: 23.5 },
    ]);
  });

  it('rounds half-away-from-zero for both signs', () => {
    // 0.05 and -0.05 should both round to magnitude 0.1, not asymmetric to 0.
    const input: Stroke[] = [
      {
        points: [{ x: 0.05, y: -0.05 }],
        timestamp: 1,
      },
    ];
    const out = quantizeStrokesForStorage(input);
    expect(out[0].points[0]).toEqual({ x: 0.1, y: -0.1 });
  });
});

describe('quantizeStrokesForStorage layer metadata', () => {
  it('preserves layerId', () => {
    const out = quantizeStrokesForStorage([
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        timestamp: 1,
        layerId: 'layer-1',
      },
    ]);
    expect(out[0].layerId).toBe('layer-1');
  });
});

describe('saveDrawing layer persistence', () => {
  it('omits layers for the default state and writes them otherwise', async () => {
    vi.resetModules();
    const add = vi.fn().mockResolvedValue(1);
    vi.doMock('./db', async (orig) => ({
      ...(await orig<typeof import('./db')>()),
      db: { drawings: { add } },
    }));
    const { saveDrawing } = await import('./drawingStore');
    const { createDefaultLayerState } = await import('../drawing/layers');
    await saveDrawing([], '', null, 0, createDefaultLayerState());
    expect(add.mock.calls[0][0]).not.toHaveProperty('layers');
    const custom = createDefaultLayerState();
    custom.layers[0].color = 'blue';
    await saveDrawing([], '', null, 0, custom);
    expect(add.mock.calls[1][0].layers).toEqual(custom.layers);
    vi.doUnmock('./db');
  });
});
