import { describe, it, expect } from 'vitest';
import { makeMannequinHarness } from './poseTestHarness';
import { segmentDistance } from './poseValidation';
import type { PoseJson } from './poseTypes';

/**
 * Smoke tests for the headless harness itself, plus regression coverage that
 * the prompt's tuned pose recipes actually pass geometric validation on the
 * REAL bundled mannequin's proportions (posePrompt.ts recipes ↔
 * poseValidation.ts must not disagree — a recipe the validator rejects burns
 * refine rounds on every generation and pushes the model to "fix" a correct
 * pose).
 */
describe('poseTestHarness', () => {
  it('standing height matches the in-app measurement (~151cm)', () => {
    const h = makeMannequinHarness();
    expect((h.rig.head!.y + 0.12) * 100).toBeCloseTo(151, 0);
  });

  it('an empty (standing) pose passes validation', () => {
    const h = makeMannequinHarness();
    expect(h.diagnose({})).toEqual([]);
  });

  it('a plain standing pose with footAt-planted feet passes', () => {
    const h = makeMannequinHarness();
    const pose: PoseJson = {
      leftLeg: { footAt: { x: 0.09, y: 0, z: 0 } },
      rightLeg: { footAt: { x: -0.09, y: 0, z: 0 } },
    };
    expect(h.diagnose(pose)).toEqual([]);
  });
});

/** Must mirror the knee-hug recipe coordinates in posePrompt.ts. */
const KNEE_HUG_RECIPE: PoseJson = {
  body: { crouch: 1, hipsHeight: 0.23, leanForward: 5 },
  head: { nod: -5 },
  leftLeg: { kneeAt: { x: 0.15, y: 0.50, z: 0.14 }, footAt: { x: 0.12, y: 0, z: 0.22 } },
  rightLeg: { kneeAt: { x: -0.15, y: 0.50, z: 0.14 }, footAt: { x: -0.12, y: 0, z: 0.22 } },
  leftArm: { handAt: { x: 0.07, y: 0.38, z: 0.20 }, elbowDirection: 'in' },
  rightArm: { handAt: { x: -0.07, y: 0.38, z: 0.17 }, elbowDirection: 'in' },
};

describe('posePrompt recipes pass validation on the real mannequin', () => {
  const RECIPES: Array<[string, PoseJson]> = [
    ['deep squat', {
      body: { crouch: 1, hipsHeight: 0.38, leanForward: 20 },
      head: { nod: -15 },
      leftLeg: { kneeAt: { x: 0.19, y: 0.45, z: 0.25 }, footAt: { x: 0.13, y: 0, z: 0.08 } },
      rightLeg: { kneeAt: { x: -0.19, y: 0.45, z: 0.25 }, footAt: { x: -0.13, y: 0, z: 0.08 } },
    }],
    ['half-kneeling (left knee up)', {
      body: { hipsHeight: 0.45 },
      leftLeg: { kneeAt: { x: 0.15, y: 0.43, z: 0.32 }, footAt: { x: 0.15, y: 0, z: 0.32 } },
      rightLeg: { kneeAt: { x: -0.10, y: 0.05, z: 0 }, footAt: { x: -0.10, y: 0.05, z: -0.35 }, ankle: -40 },
    }],
    ['all-fours', {
      body: { bend: 75, leanForward: 10, hipsHeight: 0.42 },
      head: { nod: -50 },
      leftArm: { handAt: { x: 0.15, y: 0, z: 0.40 } },
      rightArm: { handAt: { x: -0.15, y: 0, z: 0.40 } },
      leftLeg: { kneeAt: { x: 0.10, y: 0.05, z: 0 }, footAt: { x: 0.10, y: 0.04, z: -0.40 }, ankle: -50 },
      rightLeg: { kneeAt: { x: -0.10, y: 0.05, z: 0 }, footAt: { x: -0.10, y: 0.04, z: -0.40 }, ankle: -50 },
    }],
    ['knee-hug sitting (taiiku-zuwari)', KNEE_HUG_RECIPE],
    ['handstand', {
      body: { bend: 175, hipsHeight: 0.88 },
      head: { nod: -40 },
      leftArm: { handAt: { x: 0.12, y: 0, z: 0 } },
      rightArm: { handAt: { x: -0.12, y: 0, z: 0 } },
      leftLeg: { forward: 25, kneeBend: 0, ankle: -30 },
      rightLeg: { forward: -15, kneeBend: 0, ankle: -30 },
    }],
  ];

  it.each(RECIPES)('%s', (_name, pose) => {
    const h = makeMannequinHarness();
    expect(h.diagnose(pose)).toEqual([]);
  });
});

describe('knee-hug recipe silhouette', () => {
  it('reads as taiiku-zuwari: knees high at the chest, heels close, soles on the floor', () => {
    const h = makeMannequinHarness();
    const { posed, rest } = h.applyAndMeasure(KNEE_HUG_RECIPE);
    for (const side of ['left', 'right'] as const) {
      const knee = posed[`${side}LowerLeg`]!;
      const foot = posed[`${side}Foot`]!;
      // Knees pulled up against the chest, in FRONT of the hips (not folded
      // behind them, the failure shape of an over-close heel target).
      expect(knee.y).toBeGreaterThan(0.45);
      expect(knee.z).toBeGreaterThan(0.05);
      // Heels planted close to the body, soles at their rest floor offset.
      expect(foot.z).toBeLessThan(0.22);
      expect(foot.y).toBeGreaterThanOrEqual(rest[`${side}Foot`]!.y - 0.02);
      // Hands stay on their own side wrapping the shins (no midline overshoot).
      const hand = posed[`${side}Hand`]!;
      expect((side === 'left' ? 1 : -1) * hand.x).toBeGreaterThan(0.03);
    }
  });

  it('thighs do not sink into the torso volume (visual embed regression)', () => {
    // diagnosePose has no thigh×torso pair (legit sitting/squatting poses
    // press the thighs against the belly, so a capsule check would
    // false-positive) — guard the knee-hug shape with a numeric proxy
    // instead: the KNEE (far thigh end) must stay outside the torso volume.
    // The 2026-07-16 on-device report "太ももが体に埋まる" measured -0.098
    // here; surface contact is fine, deep overlap is not.
    const TORSO_HALF_DEPTH = 0.13;
    const THIGH_RADIUS = 0.065;
    const h = makeMannequinHarness();
    const { posed } = h.applyAndMeasure(KNEE_HUG_RECIPE);
    const shoulderMid = {
      x: (posed.leftUpperArm!.x + posed.rightUpperArm!.x) / 2,
      y: (posed.leftUpperArm!.y + posed.rightUpperArm!.y) / 2,
      z: (posed.leftUpperArm!.z + posed.rightUpperArm!.z) / 2,
    };
    for (const side of ['left', 'right'] as const) {
      const knee = posed[`${side}LowerLeg`]!;
      const clearance = segmentDistance(knee, knee, posed.hips!, shoulderMid)
        - TORSO_HALF_DEPTH - THIGH_RADIUS;
      expect(clearance).toBeGreaterThanOrEqual(-0.02);
    }
  });
});

describe('planted footAt floor guarantee', () => {
  it('an unreachably-close planted heel is pushed out instead of sinking below the floor', () => {
    // The 膝抱えストレッチ refine-loop failure shape: footAt so close to the
    // hip (~7cm) that the knee would have to fold past MAX_KNEE_BEND; the
    // clamped solve used to swing the ankle through the floor.
    const h = makeMannequinHarness();
    const pose: PoseJson = {
      body: { leanForward: 30, crouch: 1, hipsHeight: 0.15 },
      head: { nod: -15 },
      leftLeg: { kneeAt: { x: 0.12, y: 0.65, z: 0.35 }, footAt: { x: 0.10, y: 0, z: 0.05 } },
      rightLeg: { kneeAt: { x: -0.12, y: 0.65, z: 0.35 }, footAt: { x: -0.10, y: 0, z: 0.05 } },
    };
    const { posed, rest } = h.applyAndMeasure(pose);
    for (const name of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'] as const) {
      // The ankle stays at its rest sole height (allowing solver epsilon) and
      // nothing about the foot dives below the floor.
      expect(posed[name]!.y).toBeGreaterThanOrEqual(-0.01);
    }
    // The real rig's leg bones aren't perfectly straight, so the analytic
    // solve lands within ~1.5cm of the requested sole height — allow 2cm.
    expect(posed.leftFoot!.y).toBeGreaterThanOrEqual(rest.leftFoot!.y - 0.02);
    expect(posed.rightFoot!.y).toBeGreaterThanOrEqual(rest.rightFoot!.y - 0.02);
    const floorProblems = h.diagnose(pose).filter(p => p.includes('BELOW the floor'));
    expect(floorProblems).toEqual([]);
  });
});
