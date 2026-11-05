import type { Stroke } from './types';

/**
 * Drawing layers (see docs/layers.md).
 *
 * Strokes stay in ONE chronological array inside `StrokeManager` (so every
 * index-based undo entry keeps working unchanged); each stroke merely carries
 * an optional `layerId`. Layer order only affects rendering (z-order) and
 * which strokes the erase tools may touch.
 */

/** Display tint of a layer's strokes. `'ink'` = the normal stroke color. */
export type LayerColor = 'ink' | 'blue' | 'red';

export interface Layer {
  id: string;
  /** User-visible name. Empty ⇒ the UI shows a numbered fallback. */
  name: string;
  visible: boolean;
  /** 0.1–1. */
  opacity: number;
  locked: boolean;
  color: LayerColor;
}

/** Layer list + active layer, as persisted in the session draft / gallery record. */
export interface LayerState {
  layers: Layer[];
  activeLayerId: string;
}

/**
 * Id of the implicit layer every pre-layer stroke belongs to. Strokes on this
 * layer are stored WITHOUT a `layerId` so single-layer drawings serialize
 * exactly like before the feature.
 */
export const DEFAULT_LAYER_ID = 'base';
export const MAX_LAYERS = 8;
export const MIN_LAYER_OPACITY = 0.1;

export const LAYER_COLOR_HEX: Record<LayerColor, string> = {
  ink: '#000000',
  blue: '#2f6fdf',
  red: '#d83a3a',
};

export function createDefaultLayer(): Layer {
  return {
    id: DEFAULT_LAYER_ID,
    name: '',
    visible: true,
    opacity: 1,
    locked: false,
    color: 'ink',
  };
}

export function createDefaultLayerState(): LayerState {
  return { layers: [createDefaultLayer()], activeLayerId: DEFAULT_LAYER_ID };
}

export function layerIdOf(stroke: Stroke): string {
  return stroke.layerId ?? DEFAULT_LAYER_ID;
}

/** Return `stroke` tagged with `layerId` (omitting the field for the default layer). */
export function withLayerId(stroke: Stroke, layerId: string): Stroke {
  const { layerId: _drop, ...rest } = stroke;
  void _drop;
  return layerId === DEFAULT_LAYER_ID ? rest : { ...rest, layerId };
}

/** True when the state is the single untouched default layer (nothing worth persisting). */
export function isDefaultLayerState(state: LayerState): boolean {
  if (state.layers.length !== 1) return false;
  const l = state.layers[0];
  const d = createDefaultLayer();
  return (
    l.id === d.id &&
    l.name === d.name &&
    l.visible === d.visible &&
    l.opacity === d.opacity &&
    l.locked === d.locked &&
    l.color === d.color &&
    state.activeLayerId === d.id
  );
}

const LAYER_COLORS: readonly LayerColor[] = ['ink', 'blue', 'red'];

function clampOpacity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(MIN_LAYER_OPACITY, v));
}

/**
 * Validate persisted / imported layer data. Garbage entries are dropped,
 * duplicate ids are dropped, the list is capped at MAX_LAYERS, and an empty
 * result falls back to the default single layer. An unknown active id falls
 * back to the topmost layer.
 */
export function sanitizeLayerState(raw: unknown, rawActive?: unknown): LayerState {
  const layers: Layer[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (layers.length >= MAX_LAYERS) break;
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue;
      seen.add(r.id);
      layers.push({
        id: r.id,
        name: typeof r.name === 'string' ? r.name : '',
        visible: r.visible !== false,
        opacity: clampOpacity(r.opacity),
        locked: r.locked === true,
        color: LAYER_COLORS.includes(r.color as LayerColor) ? (r.color as LayerColor) : 'ink',
      });
    }
  }
  if (layers.length === 0) return createDefaultLayerState();
  const activeLayerId =
    typeof rawActive === 'string' && seen.has(rawActive) ? rawActive : layers[layers.length - 1].id;
  return { layers, activeLayerId };
}

/** Next unused `layer-N` id. */
export function nextLayerId(layers: readonly Layer[]): string {
  let max = 0;
  for (const l of layers) {
    const m = /^layer-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `layer-${max + 1}`;
}

export interface StrokeRenderItem {
  stroke: Stroke;
  /** Index in the StrokeManager's chronological stroke array. */
  index: number;
  color: string;
  opacity: number;
}

/**
 * Strokes in render order: layers bottom (index 0) → top, chronological within
 * a layer, hidden layers skipped. Strokes whose layer is unknown render with
 * the bottom layer (defensive — StrokeManager remaps them on load).
 */
export function orderStrokesForRender(
  strokes: readonly Stroke[],
  layers: readonly Layer[],
): StrokeRenderItem[] {
  if (layers.length === 0) {
    return strokes.map((stroke, index) => ({
      stroke,
      index,
      color: LAYER_COLOR_HEX.ink,
      opacity: 1,
    }));
  }
  const order = new Map<string, number>();
  layers.forEach((l, i) => order.set(l.id, i));
  const buckets: StrokeRenderItem[][] = layers.map(() => []);
  for (let index = 0; index < strokes.length; index++) {
    const stroke = strokes[index];
    const li = order.get(layerIdOf(stroke)) ?? 0;
    const layer = layers[li];
    if (!layer.visible) continue;
    buckets[li].push({
      stroke,
      index,
      color: LAYER_COLOR_HEX[layer.color],
      opacity: layer.opacity,
    });
  }
  return buckets.flat();
}

/**
 * Render items for a stored drawing (gallery record / export). `layers`
 * absent ⇒ pre-layer record (one default layer). If every layer is hidden the
 * result would be blank, so fall back to rendering everything — an export or
 * thumbnail of nothing is never what the user wants.
 */
export function renderItemsForStoredDrawing(
  strokes: readonly Stroke[],
  layers: readonly Layer[] | undefined,
): StrokeRenderItem[] {
  const ls = sanitizeLayerState(layers).layers;
  const items = orderStrokesForRender(strokes, ls);
  if (items.length > 0 || strokes.length === 0) return items;
  return orderStrokesForRender(
    strokes,
    ls.map((l) => ({ ...l, visible: true })),
  );
}

/** Visible strokes only (render order), for consumers that ignore styling. */
export function visibleStrokes(strokes: readonly Stroke[], layers: readonly Layer[]): Stroke[] {
  return orderStrokesForRender(strokes, layers).map((it) => it.stroke);
}
