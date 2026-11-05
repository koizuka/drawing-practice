import { StrokeManager } from './StrokeManager';
import { DEFAULT_LAYER_ID, MAX_LAYERS, layerIdOf } from './layers';

function draw(m: StrokeManager, x: number) {
  m.startStroke({ x, y: 0 });
  m.appendStroke({ x: x + 10, y: 10 });
  return m.endStroke()!;
}

describe('StrokeManager layers', () => {
  let m: StrokeManager;
  beforeEach(() => {
    m = new StrokeManager();
  });

  it('starts with the default layer and leaves strokes untagged on it', () => {
    expect(m.getLayers()).toHaveLength(1);
    expect(m.getActiveLayerId()).toBe(DEFAULT_LAYER_ID);
    const s = draw(m, 0);
    expect('layerId' in s).toBe(false);
  });

  it('tags strokes with the active layer and adds layers above the active one', () => {
    const l2 = m.addLayer({ name: 'ink' })!;
    expect(m.getActiveLayerId()).toBe(l2.id);
    const s = draw(m, 0);
    expect(s.layerId).toBe(l2.id);
    m.setActiveLayer(DEFAULT_LAYER_ID);
    const l3 = m.addLayer()!;
    expect(m.getLayers().map((l) => l.id)).toEqual([DEFAULT_LAYER_ID, l3.id, l2.id]);
  });

  it('caps the layer count', () => {
    for (let i = 1; i < MAX_LAYERS; i++) expect(m.addLayer()).not.toBeNull();
    expect(m.addLayer()).toBeNull();
  });

  it('restricts nearest-stroke hit testing to the drawable active layer', () => {
    draw(m, 0); // base
    m.addLayer();
    expect(m.findNearestStroke({ x: 0, y: 0 }, 5)).toBeNull();
    draw(m, 100);
    expect(m.findNearestStroke({ x: 100, y: 0 }, 5)).toBe(1);
    m.updateLayer(m.getActiveLayerId(), { locked: true });
    expect(m.canDrawOnActiveLayer()).toBe(false);
    expect(m.findNearestStroke({ x: 100, y: 0 }, 5)).toBeNull();
  });

  it('deletes a layer with its strokes as one undoable entry', () => {
    draw(m, 0);
    const l2 = m.addLayer()!;
    draw(m, 100);
    m.setActiveLayer(DEFAULT_LAYER_ID);
    draw(m, 200);
    m.setActiveLayer(l2.id);
    expect(m.deleteLayer(l2.id)).toBe(true);
    expect(m.getLayers()).toHaveLength(1);
    expect(m.getStrokes().map((s) => s.points[0].x)).toEqual([0, 200]);
    expect(m.getActiveLayerId()).toBe(DEFAULT_LAYER_ID);

    m.undo();
    expect(m.getLayers().map((l) => l.id)).toEqual([DEFAULT_LAYER_ID, l2.id]);
    expect(m.getStrokes().map((s) => s.points[0].x)).toEqual([0, 100, 200]);
    expect(m.getActiveLayerId()).toBe(l2.id);

    // Older stroke entries still undo consistently after the restore.
    m.undo(); // stroke 200
    expect(m.getStrokes().map((s) => s.points[0].x)).toEqual([0, 100]);

    m.redo();
    m.redo(); // layer delete again
    expect(m.getLayers()).toHaveLength(1);
    expect(m.getStrokes().map((s) => s.points[0].x)).toEqual([0, 200]);
  });

  it('refuses to delete the last layer', () => {
    expect(m.deleteLayer(DEFAULT_LAYER_ID)).toBe(false);
  });

  it('clearLayer is an undoable lasso-delete of that layer only', () => {
    draw(m, 0);
    const l2 = m.addLayer()!;
    draw(m, 100);
    m.clearLayer(l2.id);
    expect(m.getStrokes()).toHaveLength(1);
    m.undo();
    expect(m.getStrokes()).toHaveLength(2);
  });

  it('undo of a layer delete survives a committed tentative clear', () => {
    draw(m, 0);
    const l2 = m.addLayer()!;
    draw(m, 100);
    m.deleteLayer(l2.id);
    m.tentativeClear();
    draw(m, 300); // commits the clear
    m.undo(); // stroke 300
    m.undo(); // layer delete
    expect(m.getLayers().some((l) => l.id === l2.id)).toBe(true);
    expect(m.getStrokes().map((s) => s.points[0].x)).toEqual([100]);
  });

  it('moves layers and clamps opacity', () => {
    const l2 = m.addLayer()!;
    expect(m.moveLayer(l2.id, 1)).toBe(false);
    expect(m.moveLayer(l2.id, -1)).toBe(true);
    expect(m.getLayers()[0].id).toBe(l2.id);
    m.updateLayer(l2.id, { opacity: 0 });
    expect(m.getLayers()[0].opacity).toBeGreaterThan(0);
  });

  it('layer edits mark the drawing dirty but switching the active layer does not', () => {
    m.markSavedToGallery();
    m.setActiveLayer(DEFAULT_LAYER_ID);
    m.addLayer();
    expect(m.isDirtySinceGallerySave()).toBe(true);
    m.markSavedToGallery();
    m.setActiveLayer(DEFAULT_LAYER_ID);
    expect(m.isDirtySinceGallerySave()).toBe(false);
  });

  it('loadState restores layers and remaps strokes on unknown layers to the bottom layer', () => {
    m.loadState(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          timestamp: 1,
          layerId: 'layer-1',
        },
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          timestamp: 2,
          layerId: 'ghost',
        },
      ],
      [],
      {
        layers: [
          {
            id: 'layer-1',
            name: 'draft',
            visible: true,
            opacity: 0.5,
            locked: false,
            color: 'blue',
          },
          { id: 'layer-2', name: 'ink', visible: true, opacity: 1, locked: false, color: 'ink' },
        ],
        activeLayerId: 'layer-2',
      },
    );
    expect(m.getActiveLayerId()).toBe('layer-2');
    expect(m.getStrokes().map(layerIdOf)).toEqual(['layer-1', 'layer-1']);
  });

  it('loadState without layer state resets to the default layer', () => {
    m.addLayer();
    m.loadState(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          timestamp: 1,
        },
      ],
      [],
    );
    expect(m.getLayers().map((l) => l.id)).toEqual([DEFAULT_LAYER_ID]);
  });
});
