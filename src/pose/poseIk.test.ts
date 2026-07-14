import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { foldDirection, solveTwoBone, targetScale, type PoseRig } from './poseIk';
import { segmentDistance } from './poseValidation';

const LEG_AXIS = new Vector3(0, -1, 0);
const KNEE_FOLD = new Vector3(0, 0, -1);
const ARM_AXIS = new Vector3(1, 0, 0);
const ELBOW_FOLD = new Vector3(0, 0, 1);

/** FK re-check: the returned quaternions must reproduce mid and end. */
function expectConsistent(sol: ReturnType<typeof solveTwoBone>, root: Vector3, restAxis: Vector3, len1: number, len2: number) {
  const mid = root.clone().add(restAxis.clone().applyQuaternion(sol.upperWorld).multiplyScalar(len1));
  expect(mid.distanceTo(sol.mid)).toBeLessThan(1e-6);
  const lowerWorld = sol.upperWorld.clone().multiply(sol.midLocal);
  const end = mid.clone().add(restAxis.clone().applyQuaternion(lowerWorld).multiplyScalar(len2));
  expect(end.distanceTo(sol.end)).toBeLessThan(1e-6);
}

describe('solveTwoBone', () => {
  it('reaches a reachable target exactly, bulging the mid joint toward the pole', () => {
    const root = new Vector3(0, 1, 0);
    const target = new Vector3(0, 0.2, 0.3);
    const sol = solveTwoBone({
      root, target, pole: new Vector3(0, 0, 1),
      len1: 0.45, len2: 0.45, restAxis: LEG_AXIS, restFold: KNEE_FOLD,
    });
    expect(sol.end.distanceTo(target)).toBeLessThan(1e-6);
    expect(sol.mid.distanceTo(root)).toBeCloseTo(0.45, 6);
    expect(sol.mid.distanceTo(sol.end)).toBeCloseTo(0.45, 6);
    // Knee apex on the pole side of the root→target line.
    expect(sol.mid.z).toBeGreaterThan(target.z / 2);
    expect(sol.bend).toBeGreaterThan(0.1);
    expectConsistent(sol, root, LEG_AXIS, 0.45, 0.45);
  });

  it('clamps an out-of-reach target along the ray, just shy of full extension', () => {
    const root = new Vector3(0, 1, 0);
    const sol = solveTwoBone({
      root, target: new Vector3(0, -2, 0), pole: new Vector3(0, 0, 1),
      len1: 0.4, len2: 0.4, restAxis: LEG_AXIS, restFold: KNEE_FOLD,
    });
    expect(sol.end.distanceTo(root)).toBeCloseTo(0.8 * 0.999, 6);
    // Straight down, no NaN in the near-straight fold.
    expect(sol.end.y).toBeCloseTo(1 - 0.8 * 0.999, 5);
    expect(Number.isNaN(sol.upperWorld.x)).toBe(false);
    expectConsistent(sol, root, LEG_AXIS, 0.4, 0.4);
  });

  it('honors an explicit mid target (clamped to the upper bone length)', () => {
    const root = new Vector3(0, 1, 0);
    const mid = new Vector3(0, 0.7, 0.6); // farther than len1 — direction kept
    const target = new Vector3(0, 0.2, 0.3);
    const sol = solveTwoBone({
      root, target, pole: new Vector3(0, 0, 1), mid,
      len1: 0.4, len2: 0.4, restAxis: LEG_AXIS, restFold: KNEE_FOLD,
    });
    expect(sol.mid.distanceTo(root)).toBeCloseTo(0.4, 6);
    const wantDir = mid.clone().sub(root).normalize();
    const gotDir = sol.mid.clone().sub(root).normalize();
    expect(gotDir.distanceTo(wantDir)).toBeLessThan(1e-6);
    expect(sol.end.distanceTo(sol.mid)).toBeCloseTo(0.4, 6);
    expectConsistent(sol, root, LEG_AXIS, 0.4, 0.4);
  });

  it('clamps the mid-joint flex to maxBend (no thigh–shin overlap)', () => {
    const root = new Vector3(0, 0.5, 0);
    // Knee ahead, ankle pulled back almost onto the hip: unclamped this
    // solves to a ~180° fold with the shin lying inside the thigh.
    const sol = solveTwoBone({
      root, target: new Vector3(0, 0.48, 0.05), pole: new Vector3(0, 0, 1),
      mid: new Vector3(0, 0.45, 0.4),
      len1: 0.4, len2: 0.4, restAxis: LEG_AXIS, restFold: KNEE_FOLD,
      maxBend: 160 * Math.PI / 180,
    });
    expect(sol.bend).toBeLessThanOrEqual(160 * Math.PI / 180 + 1e-9);
    // The clamped end is recomputed so FK still reproduces it.
    expectConsistent(sol, root, LEG_AXIS, 0.4, 0.4);
  });

  it('handles a pole parallel to the limb without NaN (falls back to front/up)', () => {
    const root = new Vector3(0, 1, 0);
    const sol = solveTwoBone({
      root, target: new Vector3(0, 0.4, 0), pole: new Vector3(0, -1, 0), // parallel to root→target
      len1: 0.4, len2: 0.4, restAxis: LEG_AXIS, restFold: KNEE_FOLD,
    });
    expect(Number.isNaN(sol.mid.x)).toBe(false);
    expect(sol.end.distanceTo(new Vector3(0, 0.4, 0))).toBeLessThan(1e-6);
    expectConsistent(sol, root, LEG_AXIS, 0.4, 0.4);
  });

  it('solves arms with the elbow-front rest frame too', () => {
    const root = new Vector3(0.13, 1.3, 0);
    const target = new Vector3(0.13, 0.9, 0.25);
    const sol = solveTwoBone({
      root, target, pole: new Vector3(0, 0, -1), // elbow apex back = forearm folds front
      len1: 0.28, len2: 0.25, restAxis: ARM_AXIS, restFold: ELBOW_FOLD,
    });
    expect(sol.end.distanceTo(target)).toBeLessThan(1e-6);
    expectConsistent(sol, root, ARM_AXIS, 0.28, 0.25);
  });
});

describe('beam-cross recipe (posePrompt crossed-forearms coordinates)', () => {
  // The prompt's Specium-style recipe must actually solve on a nominal
  // 1.6m figure: both targets reachable, and the two forearm center lines
  // crossing with >= 5cm clearance (poseValidation's INTERSECTION_DISTANCE)
  // so the generated pose doesn't immediately fail validation.
  it('solves with reachable targets and non-interpenetrating crossed forearms', () => {
    const LEN1 = 0.28, LEN2 = 0.25;
    const right = solveTwoBone({
      root: new Vector3(-0.13, 1.3, 0),
      mid: new Vector3(-0.10, 1.10, 0.14),
      target: new Vector3(-0.08, 1.34, 0.15),
      pole: new Vector3(-1, 0, 0),
      len1: LEN1, len2: LEN2, restAxis: new Vector3(-1, 0, 0), restFold: ELBOW_FOLD,
    });
    const left = solveTwoBone({
      root: new Vector3(0.13, 1.3, 0),
      mid: new Vector3(0.15, 1.30, 0.22),
      target: new Vector3(-0.09, 1.30, 0.22),
      pole: new Vector3(1, 0, 0),
      len1: LEN1, len2: LEN2, restAxis: ARM_AXIS, restFold: ELBOW_FOLD,
    });
    // Wrists land at (or very near) the recipe targets.
    expect(right.end.distanceTo(new Vector3(-0.08, 1.34, 0.15))).toBeLessThan(0.05);
    expect(left.end.distanceTo(new Vector3(-0.09, 1.30, 0.22))).toBeLessThan(0.05);
    // The right forearm stands near-vertical; the left crosses past it AT
    // WRIST HEIGHT (the classic wrists-crossed form, not hand-on-elbow),
    // and the crossing bar is LEVEL — the solver normalizes the elbow onto
    // the len1 sphere, so this guards against a tilted-forearm regression.
    expect(right.end.y - right.mid.y).toBeGreaterThan(0.2);
    expect(left.end.x).toBeLessThan(right.end.x + 0.05);
    expect(Math.abs(left.end.y - right.end.y)).toBeLessThan(0.08);
    expect(Math.abs(left.end.y - left.mid.y)).toBeLessThan(0.02);
    // Forearm center lines cross without interpenetrating (>= 5cm apart).
    const d = segmentDistance(
      { x: left.mid.x, y: left.mid.y, z: left.mid.z },
      { x: left.end.x, y: left.end.y, z: left.end.z },
      { x: right.mid.x, y: right.mid.y, z: right.mid.z },
      { x: right.end.x, y: right.end.y, z: right.end.z },
    );
    expect(d).toBeGreaterThanOrEqual(0.05);
  });
});

describe('foldDirection', () => {
  it('projects the preferred direction off the bone axis', () => {
    const f = foldDirection(new Vector3(0, 0.5, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    expect(f.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
  });

  it('falls back when the preferred direction is parallel to the bone', () => {
    const f = foldDirection(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    expect(f.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
  });
});

describe('targetScale', () => {
  it('scales by standing height against the 1.6m nominal figure', () => {
    const rig: PoseRig = { head: { x: 0, y: 1.48, z: 0 } };
    expect(targetScale(rig)).toBeCloseTo(1, 6);
    expect(targetScale({ head: { x: 0, y: 0.68, z: 0 } })).toBeCloseTo(0.5, 6);
  });

  it('falls back to 1 for a missing or implausible head landmark', () => {
    expect(targetScale({})).toBe(1);
    expect(targetScale({ head: { x: 0, y: 0.1, z: 0 } })).toBe(1);
  });
});
