import {
  DEFAULT_LAYER_ID,
  LAYER_COLOR_HEX,
  MAX_LAYERS,
  isDefaultLayerState,
  createDefaultLayerState,
  nextLayerId,
  orderStrokesForRender,
  sanitizeLayerState,
  withLayerId,
  type Layer,
} from './layers';
import type { Stroke } from './types';

const stroke = (ts: number, layerId?: string): Stroke => ({
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  timestamp: ts,
  ...(layerId ? { layerId } : {}),
});

const layer = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  name: '',
  visible: true,
  opacity: 1,
  locked: false,
  color: 'ink',
  ...over,
});

describe('layers helpers', () => {
  it('orders strokes by layer (bottom first) and skips hidden layers', () => {
    const layers = [layer(DEFAULT_LAYER_ID, { color: 'blue', opacity: 0.5 }), layer('layer-1')];
    const strokes = [stroke(1, 'layer-1'), stroke(2), stroke(3, 'layer-1')];
    const items = orderStrokesForRender(strokes, layers);
    expect(items.map((i) => i.stroke.timestamp)).toEqual([2, 1, 3]);
    expect(items[0]).toMatchObject({ index: 1, color: LAYER_COLOR_HEX.blue, opacity: 0.5 });
    layers[1].visible = false;
    expect(orderStrokesForRender(strokes, layers).map((i) => i.index)).toEqual([1]);
  });

  it('sanitizes garbage and caps the count', () => {
    expect(sanitizeLayerState(undefined)).toEqual(createDefaultLayerState());
    const raw = [
      { id: 'a', opacity: 5, color: 'purple' },
      { id: 'a' },
      null,
      ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}` })),
    ];
    const s = sanitizeLayerState(raw, 'nope');
    expect(s.layers).toHaveLength(MAX_LAYERS);
    expect(s.layers[0]).toMatchObject({ id: 'a', opacity: 1, color: 'ink', visible: true });
    expect(s.activeLayerId).toBe(s.layers[s.layers.length - 1].id);
  });

  it('nextLayerId skips existing numbers', () => {
    expect(nextLayerId([layer('base'), layer('layer-3')])).toBe('layer-4');
  });

  it('withLayerId omits the field for the default layer', () => {
    expect('layerId' in withLayerId(stroke(1, 'layer-1'), DEFAULT_LAYER_ID)).toBe(false);
    expect(withLayerId(stroke(1), 'layer-2').layerId).toBe('layer-2');
  });

  it('isDefaultLayerState', () => {
    expect(isDefaultLayerState(createDefaultLayerState())).toBe(true);
    expect(
      isDefaultLayerState({
        layers: [layer(DEFAULT_LAYER_ID, { name: 'x' })],
        activeLayerId: 'base',
      }),
    ).toBe(false);
  });
});
