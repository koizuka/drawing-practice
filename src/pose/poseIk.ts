/**
 * Analytic two-bone IK for placement targets (handAt / footAt / elbowAt /
 * kneeAt): the LLM states WHERE a limb endpoint goes and the client derives
 * the joint rotations, instead of asking the model to hand-compute chained
 * angles (the per-pose recipe approach this replaces step by step).
 *
 * Pure math over three.js math classes (no scene graph / rendering), so the
 * solver is unit-testable without a VRM.
 *
 * Spaces: rig space = VRM normalized humanoid space (+Y up, floor y = 0,
 * faces +Z at turn 0, model's left = +X). Prompt targets are FIGURE-frame —
 * the same axes yawed by body.turn, origin on the floor below the hips — in
 * meters for a nominal 1.6 m figure; `targetScale` maps them onto the actual
 * model's proportions.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';
import { LANDMARK_NAMES, type Vec3 } from './poseValidation';

export type RigJointName = (typeof LANDMARK_NAMES)[number] | 'spine';
export const RIG_JOINT_NAMES: readonly RigJointName[] = [...LANDMARK_NAMES, 'spine'];

/** Rest (T-pose) joint positions of the actual model, in rig space. */
export type PoseRig = Partial<Record<RigJointName, Vec3>>;

/** Figure height the prompt's target coordinates assume, in meters. */
export const TARGET_NOMINAL_HEIGHT = 1.6;
/** Same top-of-head allowance poseValidation uses for its height estimate. */
const HEAD_TOP_OFFSET = 0.12;

/**
 * Nominal-figure → actual-model scale for target coordinates. Falls back to
 * 1 when the head landmark is missing or implausible (broken rig).
 */
export function targetScale(rig: PoseRig): number {
  const headY = rig.head?.y;
  return headY !== undefined && headY > 0.5 ? (headY + HEAD_TOP_OFFSET) / TARGET_NOMINAL_HEIGHT : 1;
}

export function vec3(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function perpendicular(v: Vector3, axis: Vector3): Vector3 {
  return v.clone().addScaledVector(axis, -v.dot(axis));
}

/**
 * Component of `preferred` perpendicular to boneDir, normalized. Falls back
 * to `fallback`, then to world front/up, when the candidate is (nearly)
 * parallel to the bone.
 */
export function foldDirection(preferred: Vector3, boneDir: Vector3, fallback: Vector3): Vector3 {
  for (const cand of [preferred, fallback, new Vector3(0, 0, 1), new Vector3(0, 1, 0)]) {
    const f = perpendicular(cand, boneDir);
    if (f.lengthSq() >= 0.04) return f.normalize();
  }
  return new Vector3(1, 0, 0);
}

/**
 * World rotation mapping the orthonormal rest frame (restAxis, restFold) onto
 * (boneDir, fold) — the same full-basis (twist-pinned) construction
 * poseMapping uses for the upper arm, so the mid joint's hinge plane is
 * always where the fold direction says.
 */
export function foldBasis(restAxis: Vector3, restFold: Vector3, boneDir: Vector3, fold: Vector3): Quaternion {
  const rest3 = new Vector3().crossVectors(restAxis, restFold);
  const world3 = new Vector3().crossVectors(boneDir, fold);
  const restBasis = new Matrix4().makeBasis(restAxis, restFold, rest3);
  const worldBasis = new Matrix4().makeBasis(boneDir, fold, world3);
  return new Quaternion().setFromRotationMatrix(worldBasis.multiply(restBasis.transpose()));
}

/** Pure hinge rotation of the mid bone about its rest hinge axis. */
export function hingeQuat(restAxis: Vector3, restFold: Vector3, angle: number): Quaternion {
  const hinge = new Vector3().crossVectors(restAxis, restFold).normalize();
  return new Quaternion().setFromAxisAngle(hinge, angle);
}

export interface TwoBoneSolution {
  /** World rotation of the root bone (rest axis → upper-limb direction, fold plane pinned). */
  upperWorld: Quaternion;
  /** Local rotation of the mid bone: a pure hinge (rest hinge axis, `bend` radians). */
  midLocal: Quaternion;
  /** Mid-joint (knee/elbow) flex angle, radians. */
  bend: number;
  /** Solved mid-joint position, rig space. */
  mid: Vector3;
  /** Solved end position (the target, clamped to what the limb can reach). */
  end: Vector3;
}

export interface TwoBoneOptions {
  /** Limb root joint (hip joint / shoulder), rig space. */
  root: Vector3;
  /** Desired end joint (ankle / wrist) position, rig space. */
  target: Vector3;
  /** Which way the mid joint's apex (knee / elbow point) bulges. */
  pole: Vector3;
  /** Explicit mid-joint target (kneeAt / elbowAt); overrides the pole. */
  mid?: Vector3 | null;
  len1: number;
  len2: number;
  /** Rest bone direction: (0,-1,0) for legs, (±1,0,0) for arms. */
  restAxis: Vector3;
  /** Rest flex direction of the mid joint: (0,0,-1) knees, (0,0,1) elbows. */
  restFold: Vector3;
  /**
   * Anatomical flex limit of the mid joint, radians (knee ~160°, elbow
   * ~150°). Targets that would fold further get the limit instead — the end
   * joint then stops short of its target rather than overlapping the limb.
   */
  maxBend?: number;
}

export function solveTwoBone(opts: TwoBoneOptions): TwoBoneSolution {
  const { root, target, pole, len1, len2, restAxis, restFold } = opts;
  const explicitMid = opts.mid ?? null;

  let mid: Vector3;
  let end: Vector3;
  let bulge: Vector3; // direction the mid joint was pushed toward (fold fallback)
  if (explicitMid) {
    const toMid = explicitMid.clone().sub(root);
    if (toMid.lengthSq() < 1e-8) toMid.copy(restAxis);
    mid = root.clone().addScaledVector(toMid.normalize(), len1);
    const toEnd = target.clone().sub(mid);
    if (toEnd.lengthSq() < 1e-8) toEnd.copy(toMid);
    end = mid.clone().addScaledVector(toEnd.normalize(), len2);
    bulge = toMid;
  }
  else {
    const d = target.clone().sub(root);
    let dist = d.length();
    const dHat = dist > 1e-6 ? d.divideScalar(dist) : restAxis.clone();
    // Clamp to the reachable annulus, shy of full extension so the fold
    // direction stays defined.
    dist = Math.min((len1 + len2) * 0.999, Math.max(Math.abs(len1 - len2) + 1e-3, dist));
    const e = foldDirection(pole, dHat, new Vector3(0, 0, 1));
    const cosA1 = (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist);
    const a1 = Math.acos(Math.min(1, Math.max(-1, cosA1)));
    mid = root.clone()
      .addScaledVector(dHat, Math.cos(a1) * len1)
      .addScaledVector(e, Math.sin(a1) * len1);
    end = root.clone().addScaledVector(dHat, dist);
    bulge = e;
  }

  const boneDir = mid.clone().sub(root).normalize();
  const lowerDir = end.clone().sub(mid);
  let bend = lowerDir.lengthSq() > 1e-10 ? boneDir.angleTo(lowerDir) : 0;
  // The second bone flexes toward the component of its direction that is
  // perpendicular to the first bone — opposite the bulge for a straight limb.
  const fold = foldDirection(lowerDir.clone().normalize(), boneDir, perpendicular(bulge, boneDir).negate());
  const maxBend = opts.maxBend ?? Math.PI;
  if (bend > maxBend) {
    bend = maxBend;
    const endDir = boneDir.clone().multiplyScalar(Math.cos(bend)).addScaledVector(fold, Math.sin(bend));
    end = mid.clone().addScaledVector(endDir, len2);
  }

  return {
    upperWorld: foldBasis(restAxis, restFold, boneDir, fold),
    midLocal: hingeQuat(restAxis, restFold, bend),
    bend,
    mid,
    end,
  };
}
