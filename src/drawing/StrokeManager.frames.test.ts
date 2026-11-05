import { StrokeManager } from './StrokeManager';
import { DEFAULT_FRAME_ID, SHARED_FRAME_ID, frameIdOf } from './frames';
import { orderStrokesForRender, onionSkinItems } from './layers';

function draw(m: StrokeManager, x: number) {
  m.startStroke({ x, y: 0 });
  m.appendStroke({ x: x + 10, y: 10 });
  return m.endStroke()!;
}
const xs = (m: StrokeManager) => m.getStrokes().map((s) => s.points[0].x);
const visibleXs = (m: StrokeManager) =>
  orderStrokesForRender(m.getStrokes(), m.getLayers(), m.getFrameView()).map(
    (i) => i.stroke.points[0].x,
  );

describe('StrokeManager frames', () => {
  let m: StrokeManager;
  beforeEach(() => {
    m = new StrokeManager();
  });

  it('starts with one default frame and leaves strokes untagged on it', () => {
    expect(m.getFrames()).toEqual([DEFAULT_FRAME_ID]);
    expect('frameId' in draw(m, 0)).toBe(false);
  });

  it('adds a frame after the current one and tags new strokes with it', () => {
    draw(m, 0);
    const f1 = m.addFrame()!;
    expect(m.getCurrentFrameId()).toBe(f1);
    expect(draw(m, 100).frameId).toBe(f1);
    expect(visibleXs(m)).toEqual([100]);
    m.setCurrentFrame(DEFAULT_FRAME_ID);
    expect(visibleXs(m)).toEqual([0]);
    m.addFrame();
    expect(m.getFrames().indexOf(f1)).toBe(2);
  });

  it('shared layers show on every frame and tag strokes with the SHARED marker', () => {
    m.updateLayer(m.getActiveLayerId(), { shared: true });
    const bg = draw(m, 0);
    expect(bg.frameId).toBe(SHARED_FRAME_ID);
    const ink = m.addLayer()!;
    m.addFrame();
    draw(m, 100);
    expect(visibleXs(m)).toEqual([0, 100]);
    m.setCurrentFrame(DEFAULT_FRAME_ID);
    expect(visibleXs(m)).toEqual([0]);
    expect(ink).toBeTruthy();
  });

  it('duplicate copies the current frame with fresh timestamps; undo removes both', () => {
    const a = draw(m, 0);
    const f1 = m.addFrame({ duplicate: true })!;
    expect(xs(m)).toEqual([0, 0]);
    const copy = m.getStrokes()[1];
    expect(copy.timestamp).not.toBe(a.timestamp);
    expect(frameIdOf(copy)).toBe(f1);
    m.undo();
    expect(m.getFrames()).toEqual([DEFAULT_FRAME_ID]);
    expect(xs(m)).toEqual([0]);
    m.redo();
    expect(m.getFrames()).toHaveLength(2);
    expect(m.getCurrentFrameId()).toBe(f1);
    expect(xs(m)).toEqual([0, 0]);
  });

  it('deletes a frame with its strokes as one undo entry, keeping shared strokes', () => {
    m.updateLayer(m.getActiveLayerId(), { shared: true });
    draw(m, 0); // shared background
    m.addLayer();
    draw(m, 10); // frame-0
    const f1 = m.addFrame()!;
    draw(m, 20);
    m.setCurrentFrame(DEFAULT_FRAME_ID);
    expect(m.deleteFrame(DEFAULT_FRAME_ID)).toBe(true);
    expect(m.getFrames()).toEqual([f1]);
    expect(xs(m)).toEqual([0, 20]);
    m.undo();
    expect(m.getFrames()).toEqual([DEFAULT_FRAME_ID, f1]);
    expect(m.getCurrentFrameId()).toBe(DEFAULT_FRAME_ID);
    expect(xs(m)).toEqual([0, 10, 20]);
    expect(m.deleteFrame('nope')).toBe(false);
  });

  it('atEnd appends after the last frame regardless of the current one', () => {
    const f1 = m.addFrame()!;
    m.setCurrentFrame(DEFAULT_FRAME_ID);
    const f2 = m.addFrame({ atEnd: true })!;
    expect(m.getFrames()).toEqual([DEFAULT_FRAME_ID, f1, f2]);
    expect(m.getCurrentFrameId()).toBe(f2);
    m.undo();
    expect(m.getFrames()).toEqual([DEFAULT_FRAME_ID, f1]);
  });

  it('turning sharing off moves strokes drawn while shared onto the current frame', () => {
    draw(m, 0); // per-frame stroke on frame-0 — must stay there
    const f1 = m.addFrame()!;
    m.updateLayer(m.getActiveLayerId(), { shared: true });
    draw(m, 50); // drawn while shared
    m.updateLayer(m.getActiveLayerId(), { shared: false });
    expect(m.getStrokes().map(frameIdOf)).toEqual([DEFAULT_FRAME_ID, f1]);
    expect(visibleXs(m)).toEqual([50]);
    expect('shared' in m.getActiveLayer()).toBe(false);
  });

  it('loadState keeps stroke frame tags and per-frame visibility', () => {
    const src = new StrokeManager();
    draw(src, 0);
    const f1 = src.addFrame()!;
    draw(src, 100);
    const m2 = new StrokeManager();
    m2.loadState([...src.getStrokes()], [], src.getDocState());
    expect(m2.getStrokes().map(frameIdOf)).toEqual([DEFAULT_FRAME_ID, f1]);
    expect(m2.getCurrentFrameId()).toBe(f1);
    expect(visibleXs(m2)).toEqual([100]);
    m2.setCurrentFrame(DEFAULT_FRAME_ID);
    expect(visibleXs(m2)).toEqual([0]);
  });

  it('selecting a frame marks the drawing dirty (it changes the saved view)', () => {
    m.addFrame();
    m.markSavedToGallery();
    m.setCurrentFrame(DEFAULT_FRAME_ID);
    expect(m.isDirtySinceGallerySave()).toBe(true);
  });

  it('onion skin keeps layer z-order and applies layer opacity', () => {
    const bottom = m.getActiveLayerId();
    m.updateLayer(bottom, { opacity: 0.5 });
    const top = m.addLayer()!;
    draw(m, 10); // top layer, frame-0, drawn FIRST
    m.setActiveLayer(bottom);
    draw(m, 20); // bottom layer, frame-0
    m.addFrame();
    const items = onionSkinItems(m.getStrokes(), m.getLayers(), m.getFrameView(), 1);
    expect(items.map((i) => i.stroke.points[0].x)).toEqual([20, 10]);
    expect(items[0].opacity).toBeCloseTo(items[1].opacity * 0.5);
    expect(top).toBeTruthy();
  });

  it('never accepts the reserved SHARED marker as a persisted frame id', () => {
    m.loadState([], [], { frames: [SHARED_FRAME_ID, 'frame-3'], currentFrameId: SHARED_FRAME_ID });
    expect(m.getFrames()).toEqual(['frame-3']);
    expect(m.getCurrentFrameId()).toBe('frame-3');
  });

  it('refuses to delete the last frame', () => {
    expect(m.deleteFrame(DEFAULT_FRAME_ID)).toBe(false);
  });

  it('erase hit-testing is limited to the current frame', () => {
    draw(m, 0);
    m.addFrame();
    expect(m.findNearestStroke({ x: 0, y: 0 }, 5)).toBeNull();
    draw(m, 0);
    expect(m.findNearestStroke({ x: 0, y: 0 }, 5)).toBe(1);
  });

  it('frame ids are never reissued while restorable by undo', () => {
    const f1 = m.addFrame()!;
    m.deleteFrame(f1);
    const f2 = m.addFrame()!;
    expect(f2).not.toBe(f1);
  });

  it('moves frames and persists / restores frame state', () => {
    const f1 = m.addFrame()!;
    m.moveFrame(f1, -1);
    expect(m.getFrames()).toEqual([f1, DEFAULT_FRAME_ID]);
    m.setFps(12);
    const state = m.getFrameState();
    const m2 = new StrokeManager();
    m2.loadState([], [], state);
    expect(m2.getFrameState()).toEqual(state);
    // Unknown fps / garbage frames heal to defaults.
    m2.loadState([], [], { frames: [], fps: 7 });
    expect(m2.getFrameState()).toEqual({
      frames: [DEFAULT_FRAME_ID],
      currentFrameId: DEFAULT_FRAME_ID,
      fps: 8,
    });
  });

  it('onion skin shows neighbors of per-frame layers only', () => {
    m.updateLayer(m.getActiveLayerId(), { shared: true });
    draw(m, 0); // shared — never onion
    m.addLayer();
    draw(m, 10); // frame-0
    m.addFrame();
    draw(m, 20); // frame-1
    m.addFrame();
    draw(m, 30); // frame-2
    m.setCurrentFrame(m.getFrames()[1]);
    const items = onionSkinItems(m.getStrokes(), m.getLayers(), m.getFrameView(), 1);
    expect(items.map((i) => i.stroke.points[0].x).sort()).toEqual([10, 30]);
  });
});
