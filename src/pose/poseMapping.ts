/**
 * Applies a PoseJson to a VRM humanoid's normalized bones. Ported from the
 * verified Phase-0 spike (spike/pose-llm/index.html).
 *
 * Coordinate assumptions: VRM 1.0 normalized humanoid space — model faces +Z
 * (toward the front camera), +Y up, so the model's left side is +X. Normalized
 * bone rotations are relative to the T-pose rest. `applyPose` always resets
 * the pose first, so all mutations below are absolute w.r.t. rest — the
 * `position.y -=` crouch offset relies on this reset restoring the rest
 * position.
 */

import { Matrix4, Vector3, Quaternion, type Euler } from 'three';
import type { ArmPose, ElbowDirection, LegPose, PoseJson, TouchTarget } from './poseTypes';

const DEG = Math.PI / 180;

/** Structural subset of THREE.Object3D that pose application needs. */
export interface PoseBoneLike {
  rotation: Euler;
  quaternion: Quaternion;
  position: Vector3;
}

export type PoseBoneName
  = | 'hips' | 'spine' | 'chest' | 'head'
    | 'leftUpperArm' | 'leftLowerArm' | 'rightUpperArm' | 'rightLowerArm'
    | 'leftUpperLeg' | 'leftLowerLeg' | 'rightUpperLeg' | 'rightLowerLeg';

/** Resolves a humanoid bone; returns null for bones the model doesn't have. */
export type BoneResolver = (name: PoseBoneName) => PoseBoneLike | null;

// Tuned visually against the twist-pinned arm math below (elbow out + hand at
// waist / hand to head / hand across the chest). Values are meaningless
// without that basis — re-tune if the fold-plane convention changes.
export const TOUCH_PRESETS: Record<TouchTarget, ArmPose> = {
  hip: { raise: 50, forward: 10, elbowBend: 110, elbowDirection: 'down' },
  head: { raise: 160, forward: 25, elbowBend: 140, elbowDirection: 'up' },
  chest: { raise: 35, forward: 30, elbowBend: 130, elbowDirection: 'down' },
};

/** How far the hips sink at crouch = 1, in normalized-space meters. */
const CROUCH_HIP_DROP = 0.35;

type Side = 'left' | 'right';
const SIDE_SIGN: Record<Side, 1 | -1> = { left: 1, right: -1 };

const FRONT = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

const ELBOW_WORLD_DIR: Record<ElbowDirection, Vector3> = {
  front: new Vector3(0, 0, 1),
  back: new Vector3(0, 0, -1),
  up: new Vector3(0, 1, 0),
  down: new Vector3(0, -1, 0),
};

/**
 * Direction the forearm should fold toward for elbowDirection 'front', given
 * the upper-arm direction. Anatomically, forearms fold toward the body's
 * front in most poses; when the arm points (almost) straight forward or
 * backward that projection degenerates, and the natural flex there is a curl
 * that brings the hand upward.
 */
function naturalBendDir(limbDir: Vector3): Vector3 {
  const front = FRONT.clone().addScaledVector(limbDir, -FRONT.dot(limbDir));
  if (front.lengthSq() >= 0.04) return front.normalize();
  return UP.clone().addScaledVector(limbDir, -UP.dot(limbDir)).normalize();
}

function applyArm(resolve: BoneResolver, sideName: Side, arm: ArmPose): void {
  const a = arm.touch ? TOUCH_PRESETS[arm.touch] : arm;
  const side = SIDE_SIGN[sideName];
  const upper = resolve(`${sideName}UpperArm`);
  if (upper) {
    const raise = (a.raise ?? 90) * DEG;
    const fwd = (a.forward ?? 0) * DEG;
    const dir = new Vector3(
      side * Math.sin(raise) * Math.cos(fwd),
      -Math.cos(raise),
      Math.sin(raise) * Math.sin(fwd),
    ).normalize();
    // Full-basis rotation (not shortest-arc): pin the upper arm's twist so
    // that the bone-local 'front' fold plane always faces the anatomically
    // natural direction. Shortest-arc left the twist arbitrary, which made
    // elbowDirection point somewhere unrelated once the shoulder rotated.
    const rest1 = new Vector3(side, 0, 0); // T-pose limb direction
    const rest2 = FRONT; // local fold target for elbowDirection 'front'
    const rest3 = new Vector3().crossVectors(rest1, rest2);
    const bendDir = naturalBendDir(dir);
    const d3 = new Vector3().crossVectors(dir, bendDir);
    const restBasis = new Matrix4().makeBasis(rest1, rest2, rest3);
    const targetBasis = new Matrix4().makeBasis(dir, bendDir, d3);
    upper.quaternion.setFromRotationMatrix(targetBasis.multiply(restBasis.transpose()));
  }

  const lower = resolve(`${sideName}LowerArm`);
  if (lower) {
    const bend = (a.elbowBend ?? 0) * DEG;
    lower.rotation.set(0, 0, 0);
    if (bend > 0) {
      // elbowDirection means a WORLD direction (matching the prompt's
      // wording, e.g. 'down' = the forearm hangs down from a raised upper
      // arm). Convert it into the upper arm's local space and fold the
      // forearm toward it, so the meaning holds for any arm orientation.
      const world = ELBOW_WORLD_DIR[a.elbowDirection ?? 'front'];
      const upperQuat = upper ? upper.quaternion : new Quaternion();
      const e1 = new Vector3(side, 0, 0); // forearm rest direction (local)
      const target = world.clone().applyQuaternion(upperQuat.clone().invert());
      target.addScaledVector(e1, -target.dot(e1));
      if (target.lengthSq() < 0.04) {
        // Requested direction is (nearly) parallel to the limb — fall back
        // to the natural front fold (local +Z; the twist-pinned upper arm
        // guarantees it faces the anatomically natural direction).
        target.copy(FRONT);
      }
      target.normalize();
      const axis = new Vector3().crossVectors(e1, target).normalize();
      lower.quaternion.setFromAxisAngle(axis, bend);
    }
  }
}

function applyLeg(resolve: BoneResolver, sideName: Side, leg: LegPose): void {
  const side = SIDE_SIGN[sideName];
  // Euler 'XZY' applies extrinsically Y → Z → X: the Y twist happens FIRST,
  // while the thigh still points straight down, so it is a pure axial hip
  // rotation (knee/toes turn outward); spread then abducts and X flexes the
  // already-rotated thigh. With the default 'XYZ' the twist lands after
  // spread, degenerates into a horizontal yaw, and swings the abducted thigh
  // back to the front — knees ended up facing forward in cross-legged poses.
  resolve(`${sideName}UpperLeg`)?.rotation.set(
    -(leg.forward ?? 0) * DEG,
    side * (leg.rotation ?? 0) * DEG,
    side * (leg.spread ?? 0) * DEG,
    'XZY',
  );
  resolve(`${sideName}LowerLeg`)?.rotation.set((leg.kneeBend ?? 0) * DEG, 0, 0);
}

/**
 * Deep crouch implies bent legs: keep feet plausibly grounded even if the
 * model under-reported the leg angles.
 */
function withCrouchFloor(leg: LegPose, crouch: number): LegPose {
  if (crouch <= 0.3) return leg;
  return {
    ...leg,
    forward: Math.max(leg.forward ?? 0, crouch * 90),
    kneeBend: Math.max(leg.kneeBend ?? 0, crouch * 130),
  };
}

/**
 * Applies the pose on top of the rest pose. `resetPose` must restore the
 * humanoid's normalized rest pose (rotations AND hips position) — pass
 * `() => vrm.humanoid.resetNormalizedPose()`.
 */
export function applyPose(resolve: BoneResolver, resetPose: () => void, pose: PoseJson): void {
  resetPose();

  const body = pose.body ?? {};
  const halfX = ((body.leanForward ?? 0) / 2) * DEG;
  const halfY = ((body.twist ?? 0) / 2) * DEG;
  const halfZ = (-(body.leanSide ?? 0) / 2) * DEG;
  resolve('spine')?.rotation.set(halfX, halfY, halfZ);
  resolve('chest')?.rotation.set(halfX, halfY, halfZ);

  const hips = resolve('hips');
  if (hips) {
    // Documented convention: +90 = figure faces the viewer's left (screen
    // left). The camera fronts +Z, so that is a -90° rotation about +Y.
    if (body.turn) hips.rotation.y = -body.turn * DEG;
    if (body.crouch) hips.position.y -= body.crouch * CROUCH_HIP_DROP;
  }

  const head = pose.head ?? {};
  resolve('head')?.rotation.set(
    (head.nod ?? 0) * DEG,
    (head.turn ?? 0) * DEG,
    -(head.tilt ?? 0) * DEG,
  );

  if (pose.leftArm) applyArm(resolve, 'left', pose.leftArm);
  if (pose.rightArm) applyArm(resolve, 'right', pose.rightArm);

  // A deep crouch bends the legs even when the LLM omitted them entirely.
  const crouch = body.crouch ?? 0;
  const leftLeg = pose.leftLeg ?? (crouch > 0.3 ? {} : null);
  const rightLeg = pose.rightLeg ?? (crouch > 0.3 ? {} : null);
  if (leftLeg) applyLeg(resolve, 'left', withCrouchFloor(leftLeg, crouch));
  if (rightLeg) applyLeg(resolve, 'right', withCrouchFloor(rightLeg, crouch));
}
