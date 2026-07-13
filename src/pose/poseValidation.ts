/**
 * Geometric validation of an applied pose (案2: measure → diagnose → ask the
 * model to correct). Pure math over landmark positions sampled from the posed
 * VRM (PoseViewer.measurePose supplies them) — no three.js dependency, so the
 * checks are unit-testable with synthetic data.
 *
 * Coordinate space: VRM normalized humanoid space — +Y up, floor at y = 0,
 * model faces +Z at turn 0, model's left = +X. Units are meters.
 *
 * Deliberately generic: no per-pose knowledge. Every check is a physical
 * plausibility rule (nothing below the floor, something touches it, the
 * center of mass sits over the support, limbs don't cross through each
 * other). Intentionally dynamic poses (a jump is airborne, a runner is
 * off-balance) are handled by phrasing in the feedback — the model may keep
 * the values unchanged, and the caller stops looping on an unchanged reply.
 */

import type { PoseJson } from './poseTypes';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Humanoid bones sampled as landmarks. Optional bones may be absent. */
export const LANDMARK_NAMES = [
  'hips', 'chest', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;
export type LandmarkName = (typeof LANDMARK_NAMES)[number];

export type LandmarkSet = Partial<Record<LandmarkName, Vec3>>;

/** Rest (T-pose) and posed landmark positions of the same model. */
export interface PoseMeasurement {
  rest: LandmarkSet;
  posed: LandmarkSet;
}

const DEG = Math.PI / 180;

/**
 * Approximate distance from the bone's joint center to the body surface in
 * the floor direction — a joint "touches the floor" when its height is near
 * this value. Feet and toes instead use their own REST height (the sole
 * offset measured from the actual model), so a standing pose reads as exactly
 * grounded regardless of the model's proportions.
 */
const FIXED_RADIUS: Partial<Record<LandmarkName, number>> = {
  // Generous: the buttocks extend well below the hips bone, and the fixed
  // CROUCH_HIP_DROP can't lower the pelvis all the way to a true floor sit —
  // floor-sitting poses must not be diagnosed as floating (they'd be
  // uncorrectable and would burn refine rounds on every sit).
  hips: 0.12,
  chest: 0.10,
  head: 0.11,
  leftUpperArm: 0.05, rightUpperArm: 0.05,
  leftLowerArm: 0.04, rightLowerArm: 0.04,
  leftHand: 0.03, rightHand: 0.03,
  leftUpperLeg: 0.07, rightUpperLeg: 0.07,
  leftLowerLeg: 0.05, rightLowerLeg: 0.05,
};

/**
 * Below this clearance a joint counts as supporting ground contact. This is
 * also the floating cutoff — a pose with NO joint at contact clearance is
 * diagnosed as airborne (no dead zone in between, it would let hovering
 * poses pass unvalidated).
 */
const CONTACT_CLEARANCE = 0.08;
/** More than this much below the surface is a penetration problem. */
const PENETRATION_TOLERANCE = 0.04;
/** Horizontal margin added around the contact points (feet/hands extend past their joint). */
const SUPPORT_MARGIN = 0.18;
/** Limb capsule center lines closer than this really cross through each other. */
const INTERSECTION_DISTANCE = 0.05;

/** Human-readable joint names for the feedback text. */
const PART_LABEL: Record<LandmarkName, string> = {
  hips: 'hips',
  chest: 'chest',
  head: 'head',
  leftUpperArm: 'left shoulder', rightUpperArm: 'right shoulder',
  leftLowerArm: 'left elbow', rightLowerArm: 'right elbow',
  leftHand: 'left hand', rightHand: 'right hand',
  leftUpperLeg: 'left hip joint', rightUpperLeg: 'right hip joint',
  leftLowerLeg: 'left knee', rightLowerLeg: 'right knee',
  leftFoot: 'left foot', rightFoot: 'right foot',
  leftToes: 'left toes', rightToes: 'right toes',
};

/**
 * Static-balance mass distribution, approximated onto the sampled joints.
 * Rough by design — the check only fires when the center of mass is well
 * outside the support area.
 */
const MASS_WEIGHT: Partial<Record<LandmarkName, number>> = {
  hips: 0.30,
  chest: 0.22,
  head: 0.08,
  leftLowerLeg: 0.10, rightLowerLeg: 0.10,
  leftFoot: 0.05, rightFoot: 0.05,
  leftLowerArm: 0.04, rightLowerArm: 0.04,
  leftHand: 0.01, rightHand: 0.01,
};

/** Limb segments checked for mutual intersection, as (label, from, to). */
const LIMB_SEGMENTS: ReadonlyArray<readonly [string, LandmarkName, LandmarkName]> = [
  ['left thigh', 'leftUpperLeg', 'leftLowerLeg'],
  ['right thigh', 'rightUpperLeg', 'rightLowerLeg'],
  ['left shin', 'leftLowerLeg', 'leftFoot'],
  ['right shin', 'rightLowerLeg', 'rightFoot'],
  ['left forearm', 'leftLowerArm', 'leftHand'],
  ['right forearm', 'rightLowerArm', 'rightHand'],
  ['torso', 'hips', 'chest'],
] as const;

/** Segment pairs worth checking (same-limb neighbours always "touch"). */
const SEGMENT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // thigh × thigh
  [2, 3], // shin × shin
  [0, 3], [1, 2], // thigh × opposite shin
  [4, 6], [5, 6], // forearm × torso
  [4, 5], // forearm × forearm
] as const;

function radiusOf(name: LandmarkName, rest: LandmarkSet): number {
  const fixed = FIXED_RADIUS[name];
  if (fixed !== undefined) return fixed;
  // Feet/toes: the rest-pose height of the joint IS its sole offset.
  return Math.max(0, rest[name]?.y ?? 0);
}

function cm(meters: number): number {
  return Math.round(Math.abs(meters) * 100);
}

/** Closest distance between two 3D segments (standard clamped-parameter form). */
export function segmentDistance(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): number {
  const dax = a1.x - a0.x, day = a1.y - a0.y, daz = a1.z - a0.z;
  const dbx = b1.x - b0.x, dby = b1.y - b0.y, dbz = b1.z - b0.z;
  const rx = a0.x - b0.x, ry = a0.y - b0.y, rz = a0.z - b0.z;
  const A = dax * dax + day * day + daz * daz;
  const B = dax * dbx + day * dby + daz * dbz;
  const C = dbx * dbx + dby * dby + dbz * dbz;
  const D = dax * rx + day * ry + daz * rz;
  const E = dbx * rx + dby * ry + dbz * rz;
  const denom = A * C - B * B;
  let s = denom > 1e-12 ? (B * E - C * D) / denom : 0;
  s = Math.min(1, Math.max(0, s));
  let t = C > 1e-12 ? (B * s + E) / C : 0;
  t = Math.min(1, Math.max(0, t));
  // Re-clamp s for the clamped t.
  if (A > 1e-12) {
    s = Math.min(1, Math.max(0, (B * t - D) / A));
  }
  const px = a0.x + dax * s - (b0.x + dbx * t);
  const py = a0.y + day * s - (b0.y + dby * t);
  const pz = a0.z + daz * s - (b0.z + dbz * t);
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * Run all plausibility checks. Returns one English sentence per problem —
 * empty when the pose passes.
 */
export function diagnosePose(measurement: PoseMeasurement, pose: PoseJson): string[] {
  const { rest, posed } = measurement;
  const problems: string[] = [];

  // Clearance of every sampled joint above the floor.
  const clearances = new Map<LandmarkName, number>();
  for (const name of LANDMARK_NAMES) {
    const p = posed[name];
    if (!p) continue;
    clearances.set(name, p.y - radiusOf(name, rest));
  }
  if (clearances.size === 0) return problems;

  // 1. Penetration: any joint clearly below the floor.
  for (const [name, clearance] of clearances) {
    if (clearance < -PENETRATION_TOLERANCE) {
      problems.push(`the ${PART_LABEL[name]} is about ${cm(clearance)}cm BELOW the floor.`);
    }
  }

  // 2. Floating: nothing touches the floor at all.
  const contacts = [...clearances.entries()].filter(([, c]) => c <= CONTACT_CLEARANCE).map(([n]) => n);
  let lowestName: LandmarkName | null = null;
  let lowest = Infinity;
  for (const [name, clearance] of clearances) {
    if (clearance < lowest) {
      lowest = clearance;
      lowestName = name;
    }
  }
  if (contacts.length === 0 && lowestName) {
    problems.push(
      `no body part touches the floor — the lowest point is the ${PART_LABEL[lowestName]}, about ${cm(lowest)}cm above it. `
      + 'If the pose is meant to be airborne (e.g. jumping), this is fine; otherwise ground it.',
    );
  }

  // 3. Static balance: center of mass over the support area.
  if (contacts.length > 0 && problems.length === 0) {
    let wSum = 0, comX = 0, comZ = 0;
    for (const [name, w] of Object.entries(MASS_WEIGHT) as Array<[LandmarkName, number]>) {
      const p = posed[name];
      if (!p) continue;
      wSum += w;
      comX += p.x * w;
      comZ += p.z * w;
    }
    if (wSum > 0) {
      comX /= wSum;
      comZ /= wSum;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const name of contacts) {
        const p = posed[name];
        if (!p) continue;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const dx = comX - Math.min(maxX + SUPPORT_MARGIN, Math.max(minX - SUPPORT_MARGIN, comX));
      const dz = comZ - Math.min(maxZ + SUPPORT_MARGIN, Math.max(minZ - SUPPORT_MARGIN, comZ));
      const excess = Math.sqrt(dx * dx + dz * dz);
      if (excess > 0.01) {
        // Describe the offset relative to the FIGURE's facing (turn is
        // viewer-relative; hips yaw in poseMapping is -turn about +Y).
        const t = (pose.body?.turn ?? 0) * DEG;
        const front = dx * -Math.sin(t) + dz * Math.cos(t);
        const left = dx * Math.cos(t) + dz * Math.sin(t);
        const direction = Math.abs(front) >= Math.abs(left)
          ? (front > 0 ? 'toward the figure\'s front — it would tip forward' : 'behind the figure — it would tip backward')
          : (left > 0 ? 'toward the figure\'s left — it would tip to its left' : 'toward the figure\'s right — it would tip to its right');
        const contactList = contacts.map(n => PART_LABEL[n]).join(', ');
        problems.push(
          `the body's center of mass is about ${cm(excess)}cm outside the support area (parts on the floor: ${contactList}), ${direction}. `
          + 'If this is a deliberately dynamic pose (running, mid-motion), keep it as is.',
        );
      }
    }
  }

  // 4. Limb interpenetration: capsule center lines crossing through each other.
  const segments = LIMB_SEGMENTS.map(([label, from, to]) => {
    const a = posed[from];
    const b = posed[to];
    return a && b ? { label, a, b } : null;
  });
  for (const [i, j] of SEGMENT_PAIRS) {
    const s1 = segments[i];
    const s2 = segments[j];
    if (!s1 || !s2) continue;
    const d = segmentDistance(s1.a, s1.b, s2.a, s2.b);
    if (d < INTERSECTION_DISTANCE) {
      problems.push(`the ${s1.label} passes through the ${s2.label} (their center lines are only ${cm(d)}cm apart).`);
    }
  }

  return problems;
}

/**
 * Build the correction message sent back to the model in the same
 * conversation, or null when the pose passes all checks.
 */
export function buildValidationFeedback(measurement: PoseMeasurement, pose: PoseJson): string | null {
  const problems = diagnosePose(measurement, pose);
  if (problems.length === 0) return null;
  const headY = measurement.rest.head?.y;
  const height = headY !== undefined ? ` The standing figure is about ${cm(headY + 0.12)}cm tall.` : '';
  return `I applied your pose JSON to the 3D mannequin and measured the result against the floor plane.${height} Problems detected:\n`
    + problems.map((p, i) => `${i + 1}. ${p}`).join('\n')
    + '\nAdjust the pose JSON to fix these problems while PRESERVING the intended pose — correct the numeric values, do not redesign the pose. '
    + 'If a reported problem is actually intentional for this pose, keep the relevant values unchanged. '
    + 'Reply with the corrected COMPLETE pose JSON object (same schema, no markdown fences) as the LAST thing in your reply.';
}
