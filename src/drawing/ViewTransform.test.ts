import { vi } from 'vitest';
import { ViewTransform } from './ViewTransform';

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
      vt.applyPinch(C.width / 2, C.height / 2, 2, 0, 0, C, 1);
      const t = vt.project(C, 1);
      expect(t.scale).toBe(2);
    });
  });

  describe('screenToCanvas / canvasToScreen', () => {
    it('container center maps to viewCenter', () => {
      vt.setHome(50, 30, 1);
      const p = vt.screenToCanvas(C.width / 2, C.height / 2, C, 1);
      expect(p.x).toBeCloseTo(50);
      expect(p.y).toBeCloseTo(30);
    });

    it('round-trips after a pinch', () => {
      vt.applyPinch(100, 200, 2.5, 30, -10, C, 1);
      const sx = 240, sy = 180;
      const w = vt.screenToCanvas(sx, sy, C, 1);
      const back = vt.canvasToScreen(w.x, w.y, C, 1);
      expect(back.x).toBeCloseTo(sx);
      expect(back.y).toBeCloseTo(sy);
    });
  });

  describe('applyPinch', () => {
    it('keeps the focal world point under the focal screen point', () => {
      const focalX = 250, focalY = 150;
      const before = vt.screenToCanvas(focalX, focalY, C, 1);
      vt.applyPinch(focalX, focalY, 2, 0, 0, C, 1);
      const after = vt.screenToCanvas(focalX, focalY, C, 1);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    });

    it('clamps zoom to MIN_ZOOM', () => {
      vt.applyPinch(0, 0, 0.001, 0, 0, C, 1);
      expect(vt.getCamera().zoom).toBe(0.25);
    });

    it('clamps zoom to MAX_ZOOM', () => {
      vt.applyPinch(0, 0, 100, 0, 0, C, 1);
      expect(vt.getCamera().zoom).toBe(8);
    });

    it('translates by pan delta when scaleDelta is 1', () => {
      const focalX = 100, focalY = 100;
      vt.applyPinch(focalX, focalY, 1, 50, 30, C, 1);
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
      vt.applyPinch(C.width / 2, C.height / 2, 2, 0, 0, C, 1);
      const centerWorld = vt.screenToCanvas(C.width / 2, C.height / 2, C, 1);

      const wider = { width: C.width * 2, height: C.height };
      const stillCenter = vt.screenToCanvas(wider.width / 2, wider.height / 2, wider, 1);
      expect(stillCenter.x).toBeCloseTo(centerWorld.x);
      expect(stillCenter.y).toBeCloseTo(centerWorld.y);
    });
  });

  describe('home / reset', () => {
    it('reset returns to home', () => {
      vt.setHome(100, 200, 1);
      vt.applyPinch(0, 0, 2, 50, 30, C, 1);
      expect(vt.isDirty()).toBe(true);
      vt.reset();
      expect(vt.isDirty()).toBe(false);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(100);
      expect(cam.viewCenterY).toBe(200);
      expect(cam.zoom).toBe(1);
    });

    it('setHome snaps to the new home from a clean camera', () => {
      vt.setHome(150, 75, 1);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(150);
      expect(cam.viewCenterY).toBe(75);
      expect(vt.isDirty()).toBe(false);
    });

    it('setHome snaps a dirty camera to the new home (reference-load semantics)', () => {
      vt.applyPinch(0, 0, 2, 50, 30, C, 1);
      expect(vt.isDirty()).toBe(true);
      vt.setHome(500, 500, 1);
      const cam = vt.getCamera();
      expect(cam.viewCenterX).toBe(500);
      expect(cam.viewCenterY).toBe(500);
      expect(cam.zoom).toBe(1);
      expect(vt.isDirty()).toBe(false);
    });

    it('setHome with same values is a no-op (no notify)', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.setHome(0, 0, 1); // already at home
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('notifies on applyPinch', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.applyPinch(0, 0, 2, 0, 0, C, 1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('notifies on reset when dirty', () => {
      vt.applyPinch(0, 0, 2, 0, 0, C, 1);
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.reset();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('skips notify when reset is called on a clean camera', () => {
      const fn = vi.fn();
      vt.subscribe(fn);
      vt.reset();
      expect(fn).not.toHaveBeenCalled();
    });

    it('notifies multiple listeners', () => {
      const a = vi.fn();
      const b = vi.fn();
      vt.subscribe(a);
      vt.subscribe(b);
      vt.applyPinch(0, 0, 2, 0, 0, C, 1);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('unsubscribed listeners stop firing', () => {
      const fn = vi.fn();
      const off = vt.subscribe(fn);
      off();
      vt.applyPinch(0, 0, 2, 0, 0, C, 1);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
