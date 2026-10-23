import {
  displayRotationDegrees,
  isRightAngleRotation,
  nextRotationStep,
  screenToCanvasRotation,
  shortestAngleDelta,
  snapRotationTarget,
} from './rotation';

const deg = (d: number) => (d * Math.PI) / 180;

describe('rotation helpers', () => {
  it('shortestAngleDelta crosses the ±180° seam the short way', () => {
    expect(shortestAngleDelta(deg(170), deg(-170))).toBeCloseTo(deg(20));
    expect(shortestAngleDelta(deg(-170), deg(170))).toBeCloseTo(deg(-20));
  });

  it('snapRotationTarget snaps within ±5° of every 90°', () => {
    expect(snapRotationTarget(deg(4))).toBe(0);
    expect(snapRotationTarget(deg(-4.9))).toBe(0);
    expect(snapRotationTarget(deg(6))).toBeNull();
    expect(snapRotationTarget(deg(87))).toBeCloseTo(deg(90));
    expect(snapRotationTarget(deg(-93))).toBeCloseTo(deg(-90));
    expect(snapRotationTarget(deg(178))).toBeCloseTo(Math.PI);
    expect(snapRotationTarget(deg(-178))).toBeCloseTo(Math.PI);
    expect(snapRotationTarget(deg(45))).toBeNull();
  });

  it('nextRotationStep lands on the 15° grid', () => {
    expect(nextRotationStep(0, 1)).toBeCloseTo(deg(15));
    expect(nextRotationStep(0, -1)).toBeCloseTo(deg(-15));
    expect(nextRotationStep(deg(23), 1)).toBeCloseTo(deg(30));
    expect(nextRotationStep(deg(23), -1)).toBeCloseTo(deg(15));
    expect(nextRotationStep(deg(15), -1)).toBeCloseTo(0);
    // Wraps through 180°.
    expect(nextRotationStep(Math.PI, 1)).toBeCloseTo(deg(-165));
  });

  it('flip mirrors the screen direction', () => {
    expect(screenToCanvasRotation(deg(30), true)).toBeCloseTo(deg(-30));
    expect(screenToCanvasRotation(deg(30), false)).toBeCloseTo(deg(30));
    expect(displayRotationDegrees(deg(30), true)).toBe(-30);
    expect(displayRotationDegrees(deg(-180), false)).toBe(180);
    expect(displayRotationDegrees(-0, true)).toBe(0);
  });

  it('isRightAngleRotation', () => {
    expect(isRightAngleRotation(0)).toBe(true);
    expect(isRightAngleRotation(deg(90))).toBe(true);
    expect(isRightAngleRotation(Math.PI)).toBe(true);
    expect(isRightAngleRotation(deg(15))).toBe(false);
  });
});
