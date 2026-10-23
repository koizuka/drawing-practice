import { vi } from 'vitest';
import { ViewTransform, normalizeRotation, type CameraIntent } from './ViewTransform';

const C = { width: 800, height: 600 };

describe('ViewTransform (camera model)', () => {
  let vt: ViewTransform;

  beforeEach(() => {
    vt = new ViewTransform();
  });

  it('starts at home (viewCenter=(0,0), zoom=1)', () => {
    const cam = vt.getCamera();
    expect(cam.viewCenterX).toBe(0);
    expect(cam.viewCenterY).toBe(0);
    expect(cam.zoom).toBe(1);
    expect(vt.isDirty()).toBe(false);
  });

  describe('project', () => {
    it('puts world (0,0) at the container center when home is (0,0) and baseScale is 1', () => {
      const t = vt.project(C, 1);
      expect(t.scale).toBe(1);
      expect(t.offsetX).toBe(C.width / 2);
      expect(t.offsetY).toBe(C.height / 2);
    });

    it('scales by baseScale * zoom', () => {
      vt.applyGesture(C.width / 2, C.height / 2, 2, 0, 0, C, 1);
      const t = vt.project(C, 1);
      expect(t.scale).toBe(2);
    });
  });

  describe('screenToCanvas / canvasToScreen', () => {
    it('container center maps to viewCenter', () => {
      vt.loadContent(50, 30, 1);
      const p = vt.screenToCanvas(C.width / 2, C.height / 2, C, 1);
      expect(p.x).toBeCloseTo(50);
      expect(p.y).toBeCloseTo(30);
    });

    it('round-trips after a gesture', () => {
      vt.applyGesture(100, 200, 2.5, 30, -10, C, 1);
      const sx = 240,
        sy = 180;
      const w = vt.screenToCanvas(sx, sy, C, 1);
      const back = vt.canvasToScreen(w.x, w.y, C, 1);
      expect(back.x).toBeCloseTo(sx);
      expect(back.y).toBeCloseTo(sy);
    });
  });

  describe('applyGesture', () => {
    it('keeps the focal world point under the focal screen point', () => {
      const focalX = 250,
        focalY = 150;
      const before = vt.screenToCanvas(focalX, focalY, C, 1);
      vt.applyGesture(focalX, focalY, 2, 0, 0, C, 1);
      const after = vt.screenToCanvas(focalX, focalY, C, 1);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    });

    it('clamps zoom to MIN_ZOOM', () => {
      vt.applyGesture(0, 0, 0.001, 0, 0, C, 1);
      expect(vt.getCamera().zoom).toBe(0.25);
    });

    it('clamps zoom to MAX_ZOOM', () => {
      vt.applyGesture(0, 0, 100, 0, 0, C, 1);
      expect(vt.getCamera().zoom).toBe(8);
    });

    it('translates by pan delta when scaleDelta is 1', () => {
      const focalX = 100,
        focalY = 100;
      vt.applyGesture(focalX, focalY, 1, 50, 30, C, 1);
      // After pan, the world point that WAS at (focalX, focalY) is now at
      // (focalX + 50, focalY + 30) — i.e. pan moves content with the gesture.
      const w = vt.screenToCanvas(focalX + 50, focalY + 30, C, 1);
      expect(w.x).toBeCloseTo(0 + (focalX - C.width / 2));
      expect(w.y).toBeCloseTo(0 + (focalY - C.height / 2));
    });
  });

  describe('container-independent state', () => {
    it('preserves visual center across container resize', () => {
      // Pinch at the center, then check that the same world point is still
      // visible at the center of a larger container. The point of the camera
      // model is that the same camera state projects correctly into any
      // container size.
      vt.applyGesture(C.width / 2, C.height / 2, 2, 0, 0, C, 1);
      const centerWorld = vt.screenToCanvas(C.width / 2, C.height / 2, C, 1);

      const wider = { width: C.width * 2, height: C.height };
      const stillCenter = vt.screenToCanvas(wider.width / 2, wider.height / 2, wider, 1);
      expect(stillCenter.x).toBeCloseTo(centerWorld.x);
      expect(stillCenter.y).toBeCloseTo(centerWorld.y);
    });
  });

  describe('home / userResetToHome', () => {
    it('userResetToHome returns to the registered home', () => {
      vt.loadContent(100, 200, 1);
      vt.applyGesture(0, 0, 2, 50, 30, C, 1);
      expect(vt.isDirty()).toBe(true);
      vt.userResetToHome();
      expect(vt.isDirty()).toBe(false);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(100);
      expect(cam.viewCenterY).toBe(200);
      expect(cam.zoom).toBe(1);
    });

    it('loadContent snaps to the new home from a clean camera', () => {
      vt.loadContent(150, 75, 1);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(150);
      expect(cam.viewCenterY).toBe(75);
      expect(vt.isDirty()).toBe(false);
    });

    it('loadContent snaps a dirty camera to the new home (reference-load semantics)', () => {
      vt.applyGesture(0, 0, 2, 50, 30, C, 1);
      expect(vt.isDirty()).toBe(true);
      vt.loadContent(500, 500, 1);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(500);
      expect(cam.viewCenterY).toBe(500);
      expect(cam.zoom).toBe(1);
      expect(vt.isDirty()).toBe(false);
    });

    it('loadContent with same values is a no-op (no notify)', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.loadContent(0, 0, 1); // already at home
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('restoreCamera', () => {
    it('sets the camera without changing the registered home', () => {
      vt.loadContent(50, 75, 1); // home and camera at (50, 75, 1)
      vt.restoreCamera(200, -100, 3);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(200);
      expect(cam.viewCenterY).toBe(-100);
      expect(cam.zoom).toBe(3);
      // Home unchanged: userResetToHome returns to (50, 75, 1)
      vt.userResetToHome();
      const home = vt.getCamera();
      expect(home.viewCenterX).toBe(50);
      expect(home.viewCenterY).toBe(75);
      expect(home.zoom).toBe(1);
    });

    it('clamps zoom to MIN_ZOOM / MAX_ZOOM', () => {
      vt.restoreCamera(0, 0, 0.001);
      expect(vt.getCamera().zoom).toBe(0.25);
      vt.restoreCamera(0, 0, 100);
      expect(vt.getCamera().zoom).toBe(8);
    });

    it('notifies subscribers on change', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.restoreCamera(10, 20, 1.5);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when called with current values', () => {
      vt.restoreCamera(10, 20, 1.5);
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.restoreCamera(10, 20, 1.5);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('adjustForUnfit', () => {
    it('preserves visualScale (baseScale * zoom) across baseScale change', () => {
      // Start with zoom=2 fitted to a baseScale of 0.5 → visualScale 1.
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      const beforeZoom = vt.getCamera().zoom;
      vt.adjustForUnfit(0.5, 1);
      // newZoom = oldZoom * (0.5 / 1) = 1 → visualScale 1*1 = 1, same as before.
      expect(vt.getCamera().zoom).toBeCloseTo(beforeZoom * 0.5);
    });

    it('is a no-op when prevBaseScale equals newBaseScale', () => {
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      const before = vt.getCamera().zoom;
      vt.adjustForUnfit(1, 1);
      expect(vt.getCamera().zoom).toBe(before);
    });

    it('clamps the resulting zoom into the valid range', () => {
      vt.applyGesture(0, 0, 8, 0, 0, C, 1); // max zoom 8
      vt.adjustForUnfit(8, 1); // would be 64, clamps to 8
      expect(vt.getCamera().zoom).toBe(8);
    });
  });

  describe('subscribe', () => {
    it('notifies on applyGesture', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('notifies on userResetToHome when dirty', () => {
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.userResetToHome();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('skips notify when userResetToHome is called on a clean camera', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.userResetToHome();
      expect(fn).not.toHaveBeenCalled();
    });

    it('notifies multiple listeners', () => {
      const a = vi.fn();
      const b = vi.fn();
      vt.subscribe(a);
      vt.subscribe(b);
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('unsubscribed listeners stop firing', () => {
      const fn = vi.fn();
      const off = vt.subscribe(fn);
      off();
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      expect(fn).not.toHaveBeenCalled();
    });

    it('also fires on adjustForUnfit (canvases need redraw)', () => {
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.adjustForUnfit(0.5, 1);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe intents', () => {
    it('forwards the right intent for each mutator', () => {
      const intents: (CameraIntent | null)[] = [];
      vt.subscribe((i) => {
        intents.push(i);
      });

      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      vt.userResetToHome();
      vt.loadContent(100, 200, 1);
      vt.restoreCamera(50, 50, 1.5);

      expect(intents).toEqual(['gesture', 'userReset', 'contentLoad', 'restore']);
    });

    it('forwards null for adjustForUnfit (render-side, not user intent)', () => {
      vt.applyGesture(0, 0, 2, 0, 0, C, 1);
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.adjustForUnfit(0.5, 1);
      expect(fn).toHaveBeenCalledWith(null);
    });
  });
  describe('rotation', () => {
    const deg = (d: number) => (d * Math.PI) / 180;

    it('normalizeRotation wraps into (-π, π] and collapses -0', () => {
      expect(normalizeRotation(deg(190))).toBeCloseTo(deg(-170));
      expect(normalizeRotation(deg(-180))).toBeCloseTo(Math.PI);
      expect(normalizeRotation(2 * Math.PI)).toBe(0);
      expect(Object.is(normalizeRotation(-0), 0)).toBe(true);
      expect(normalizeRotation(Number.NaN)).toBe(0);
    });

    it('rotates about the focal point: the focal world point stays under the fingers', () => {
      const focalX = 300,
        focalY = 200;
      const before = vt.screenToCanvas(focalX, focalY, C, 1, true);
      vt.applyGesture(focalX, focalY, 1.5, 0, 0, C, 1, { rotated: true, rotationDelta: deg(30) });
      const after = vt.screenToCanvas(focalX, focalY, C, 1, true);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(vt.getRotation()).toBeCloseTo(deg(30));
    });

    it('positive rotation turns content clockwise on screen (canvas y-down)', () => {
      vt.applyGesture(C.width / 2, C.height / 2, 1, 0, 0, C, 1, {
        rotated: true,
        rotationDelta: deg(90),
      });
      // World +x (right of center) now points screen-down.
      const p = vt.canvasToScreen(100, 0, C, 1, true);
      expect(p.x).toBeCloseTo(C.width / 2);
      expect(p.y).toBeCloseTo(C.height / 2 + 100);
    });

    it('projectMatrix / screenToCanvas / canvasToScreen agree under rotation', () => {
      vt.applyGesture(120, 80, 2, 15, -25, C, 0.8, { rotated: true, rotationDelta: deg(-47) });
      const m = vt.projectMatrix(C, 0.8, true);
      const w = { x: 37, y: -12 };
      const s = vt.canvasToScreen(w.x, w.y, C, 0.8, true);
      expect(m.a * w.x + m.c * w.y + m.e).toBeCloseTo(s.x);
      expect(m.b * w.x + m.d * w.y + m.f).toBeCloseTo(s.y);
      const back = vt.screenToCanvas(s.x, s.y, C, 0.8, true);
      expect(back.x).toBeCloseTo(w.x);
      expect(back.y).toBeCloseTo(w.y);
      expect(m.scale).toBeCloseTo(1.6);
    });

    it('upright (non-rotated) callers ignore rotation and never change it', () => {
      vt.applyGesture(400, 300, 1, 0, 0, C, 1, { rotated: true, rotationDelta: deg(40) });
      const cam = vt.getCamera();
      // Same center/zoom seen upright as project() reports.
      const p = vt.screenToCanvas(C.width / 2 + 10, C.height / 2, C, 1);
      expect(p.x).toBeCloseTo(cam.viewCenterX + 10);
      expect(p.y).toBeCloseTo(cam.viewCenterY);
      // A reference-panel pan (rotated=false) translates in world axes and
      // ignores any rotationDelta.
      vt.applyGesture(0, 0, 1, -20, 0, C, 1, { rotationDelta: deg(10) });
      expect(vt.getCamera().viewCenterX).toBeCloseTo(cam.viewCenterX + 20);
      expect(vt.getRotation()).toBeCloseTo(deg(40));
    });

    it('a rotated pan follows the fingers in the rotated frame', () => {
      vt.applyGesture(400, 300, 1, 0, 0, C, 1, { rotated: true, rotationDelta: deg(90) });
      const sx = 100,
        sy = 100;
      const w = vt.screenToCanvas(sx, sy, C, 1, true);
      vt.applyGesture(sx, sy, 1, 30, 40, C, 1, { rotated: true });
      const s = vt.canvasToScreen(w.x, w.y, C, 1, true);
      expect(s.x).toBeCloseTo(sx + 30);
      expect(s.y).toBeCloseTo(sy + 40);
    });

    it('setRotationAbout keeps the pivot fixed and emits the given intent', () => {
      const intents: (CameraIntent | null)[] = [];
      vt.subscribe((i) => {
        intents.push(i);
      });
      const before = vt.screenToCanvas(200, 100, C, 1, true);
      vt.setRotationAbout(deg(-15), 200, 100, C, 1, 'gesture');
      const after = vt.screenToCanvas(200, 100, C, 1, true);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(vt.getRotation()).toBeCloseTo(deg(-15));
      // Same angle with 'userRotate' still notifies (promotes the save).
      vt.setRotationAbout(deg(-15), 200, 100, C, 1, 'userRotate');
      vt.setRotationAbout(deg(-15), 200, 100, C, 1, 'gesture');
      expect(intents).toEqual(['gesture', 'userRotate']);
    });

    it('rotation makes the camera dirty; reset / loadContent clear it', () => {
      vt.setRotationAbout(deg(5), 400, 300, C, 1, 'userRotate');
      expect(vt.isDirty()).toBe(true);
      vt.userResetToHome();
      expect(vt.getRotation()).toBe(0);
      expect(vt.isDirty()).toBe(false);
      vt.setRotationAbout(deg(5), 400, 300, C, 1, 'userRotate');
      vt.loadContent(0, 0, 1);
      expect(vt.getRotation()).toBe(0);
    });

    it('restoreCamera round-trips rotation; absent rotation ≡ 0', () => {
      vt.restoreCamera(10, 20, 2, deg(30));
      expect(vt.getCamera()).toEqual({
        viewCenterX: 10,
        viewCenterY: 20,
        zoom: 2,
        rotation: normalizeRotation(deg(30)),
      });
      vt.restoreCamera(10, 20, 2);
      expect(vt.getRotation()).toBe(0);
    });
  });
});
