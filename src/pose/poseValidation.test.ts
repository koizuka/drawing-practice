import { describe, it, expect } from 'vitest';
import {
  buildValidationFeedback,
  diagnosePose,
  segmentDistance,
  type LandmarkSet,
  type PoseMeasurement,
  type Vec3,
} from './poseValidation';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Rough standing rest pose of a ~1.5m figure (also used as the T-pose). */
function standingRest(): LandmarkSet {
  return {
    hips: v(0, 0.85, 0),
    chest: v(0, 1.10, 0),
    head: v(0, 1.40, 0),
    leftUpperArm: v(0.12, 1.25, 0),
    leftLowerArm: v(0.35, 1.25, 0),
    leftHand: v(0.58, 1.25, 0),
    rightUpperArm: v(-0.12, 1.25, 0),
    rightLowerArm: v(-0.35, 1.25, 0),
    rightHand: v(-0.58, 1.25, 0),
    leftUpperLeg: v(0.08, 0.80, 0),
    leftLowerLeg: v(0.08, 0.45, 0),
    leftFoot: v(0.08, 0.08, 0),
    leftToes: v(0.08, 0.02, 0.10),
    rightUpperLeg: v(-0.08, 0.80, 0),
    rightLowerLeg: v(-0.08, 0.45, 0),
    rightFoot: v(-0.08, 0.08, 0),
    rightToes: v(-0.08, 0.02, 0.10),
  };
}

function measurement(posed: LandmarkSet): PoseMeasurement {
  return { rest: standingRest(), posed };
}

function shift(set: LandmarkSet, dy: number): LandmarkSet {
  return Object.fromEntries(
    Object.entries(set).map(([k, p]) => [k, v(p.x, p.y + dy, p.z)]),
  ) as LandmarkSet;
}

describe('segmentDistance', () => {
  it('measures crossing and parallel segments', () => {
    expect(segmentDistance(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0.5), v(0, 1, 0.5))).toBeCloseTo(0.5);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(1, 1, 0))).toBeCloseTo(1);
    // Disjoint colinear segments: closest endpoints.
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(3, 0, 0), v(4, 0, 0))).toBeCloseTo(2);
  });
});

describe('diagnosePose', () => {
  it('passes a plausible standing pose', () => {
    expect(diagnosePose(measurement(standingRest()), {})).toEqual([]);
    expect(buildValidationFeedback(measurement(standingRest()), {})).toBeNull();
  });

  it('reports joints below the floor', () => {
    const posed = standingRest();
    posed.leftFoot = v(0.08, -0.10, 0);
    const problems = diagnosePose(measurement(posed), {});
    expect(problems.some(p => p.includes('left foot') && p.includes('BELOW the floor'))).toBe(true);
  });

  it('reports a fully airborne figure with the lowest part', () => {
    const posed = shift(standingRest(), 0.30);
    const problems = diagnosePose(measurement(posed), {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no body part touches the floor');
    expect(problems[0]).toMatch(/left (foot|toes)/);
  });

  it('flags a slight hover just past contact clearance (no dead zone between contact and floating)', () => {
    // 10cm hover: above the 8cm contact cutoff, so nothing supports the
    // figure — must be diagnosed, not silently passed.
    const posed = shift(standingRest(), 0.10);
    const problems = diagnosePose(measurement(posed), {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no body part touches the floor');
  });

  it('does not flag a floor-sitting pelvis as floating (hips radius covers the crouch-drop gap)', () => {
    // Girl-style sitting approximation: hips low but not literally at 0,
    // knees and feet on the floor.
    const posed: LandmarkSet = {
      ...standingRest(),
      hips: v(0, 0.19, 0),
      chest: v(0, 0.45, 0),
      head: v(0, 0.75, 0),
      leftUpperLeg: v(0.06, 0.16, 0.02),
      rightUpperLeg: v(-0.06, 0.16, 0.02),
      leftLowerLeg: v(0.07, 0.07, 0.35),
      rightLowerLeg: v(-0.07, 0.07, 0.35),
      leftFoot: v(0.18, 0.05, 0.05),
      rightFoot: v(-0.18, 0.05, 0.05),
      leftToes: v(0.20, 0.03, -0.05),
      rightToes: v(-0.20, 0.03, -0.05),
      leftHand: v(0.15, 0.30, 0.15),
      rightHand: v(-0.15, 0.30, 0.15),
      leftLowerArm: v(0.14, 0.50, 0.05),
      rightLowerArm: v(-0.14, 0.50, 0.05),
      leftUpperArm: v(0.12, 0.65, 0),
      rightUpperArm: v(-0.12, 0.65, 0),
    };
    expect(diagnosePose(measurement(posed), { body: { crouch: 1 } })).toEqual([]);
  });

  it('reports an off-support center of mass with a figure-relative direction', () => {
    // Torso mass way in front (+Z) of the feet, facing the viewer (turn 0).
    const posed = standingRest();
    posed.hips = v(0, 0.85, 0.6);
    posed.chest = v(0, 1.0, 0.7);
    posed.head = v(0, 1.1, 0.8);
    const problems = diagnosePose(measurement(posed), { body: { turn: 0 } });
    expect(problems.some(p => p.includes('center of mass') && p.includes('tip forward'))).toBe(true);
  });

  it('reports crossing limbs', () => {
    const posed = standingRest();
    // Right shin swung across the left shin's line, center lines ~1cm apart.
    posed.rightLowerLeg = v(0.30, 0.45, 0.01);
    posed.rightFoot = v(-0.30, 0.08, 0.01);
    const problems = diagnosePose(measurement(posed), {});
    expect(problems.some(p => p.includes('passes through'))).toBe(true);
  });

  it('reports nothing when no landmarks were sampled', () => {
    expect(diagnosePose({ rest: {}, posed: {} }, {})).toEqual([]);
  });
});

describe('buildValidationFeedback', () => {
  it('numbers the problems and asks for a complete corrected JSON', () => {
    const posed = standingRest();
    posed.leftFoot = v(0.08, -0.10, 0);
    posed.rightHand = v(-0.3, -0.10, 0.2);
    const feedback = buildValidationFeedback(measurement(posed), {});
    expect(feedback).toContain('1. ');
    expect(feedback).toContain('2. ');
    expect(feedback).toContain('COMPLETE pose JSON');
    // Figure height from the rest head landmark.
    expect(feedback).toMatch(/about 15\dcm tall/);
  });
});
