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
    | 'leftHand' | 'rightHand'
    | 'leftUpperLeg' | 'leftLowerLeg' | 'rightUpperLeg' | 'rightLowerLeg'
    | 'leftFoot' | 'rightFoot';

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

/**
 * Applied when the pose omits an arm entirely: the normalized rest pose is a
 * T-pose, which reads as unnatural for any pose that simply doesn't involve
 * the arms. Slightly abducted/bent so the arm hangs without clipping the
 * torso or thigh.
 */
const RELAXED_ARM: ArmPose = { raise: 12, forward: 5, elbowBend: 8 };

type Side = 'left' | 'right';
const SIDE_SIGN: Record<Side, 1 | -1> = { left: 1, right: -1 };

const FRONT = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

const ELBOW_WORLD_DIR: Record<Exclude<ElbowDirection, 'in' | 'out'>, Vector3> = {
  front: new Vector3(0, 0, 1),
  back: new Vector3(0, 0, -1),
  up: new Vector3(0, 1, 0),
  down: new Vector3(0, -1, 0),
};

/**
 * World direction the forearm should fold toward. 'in' / 'out' are
 * side-dependent (medial = toward the body's midline, lateral = away) —
 * the model's left is +X, so left-arm 'in' points -X and right-arm 'in' +X.
 */
function elbowWorldDir(dir: ElbowDirection, side: 1 | -1): Vector3 {
  if (dir === 'in') return new Vector3(-side, 0, 0);
  if (dir === 'out') return new Vector3(side, 0, 0);
  return ELBOW_WORLD_DIR[dir];
}

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
      const world = elbowWorldDir(a.elbowDirection ?? 'front', side);
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

  // Hand: forearm pronation/supination (a twist about the hand bone's own
  // X axis — kept on the hand so the elbow fold math above stays untouched),
  // plus the wrist hinge. 'XYZ' composes intrinsically as twist-then-hinge:
  // the flexion/extension axis rides on the pronated frame, so a planted
  // palm stays flat while the twist aims the fingers — pronation reorients
  // the whole wrist joint, as anatomy does. In the T-pose rest (palm down,
  // fingers along ±X): -X rotation rolls the palm toward the front
  // (forearmTwist +), and the hinge lifts the fingertips upward for wrist +
  // (a +Z rotation on the left side, -Z on the right).
  resolve(`${sideName}Hand`)?.rotation.set(
    -(a.forearmTwist ?? 0) * DEG,
    0,
    side * (a.wrist ?? 0) * DEG,
    'XYZ',
  );
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
  // 'XYZ' applies Y before X, so shinTwist is a pure twist about the shin's
  // own bone axis (tibial rotation carried through the bend) — it reorients
  // the foot without moving the shin's direction. Explicit order: the
  // kinematics depend on it, so don't rely on the Euler default.
  resolve(`${sideName}LowerLeg`)?.rotation.set(
    (leg.kneeBend ?? 0) * DEG,
    side * (leg.shinTwist ?? 0) * DEG,
    0,
    'XYZ',
  );
  // Positive X on the foot bone plantar-flexes (toes down); ankle is defined
  // as + = dorsiflexion (toes toward the shin), hence the sign flip.
  resolve(`${sideName}Foot`)?.rotation.set(-(leg.ankle ?? 0) * DEG, 0, 0);
}

/**
 * Deep crouch implies bent legs: fill in leg angles the model OMITTED so the
 * feet stay plausibly grounded. Explicit values are respected as-is — e.g.
 * knee-hug sitting legitimately uses a shallower kneeBend than a squat, and
 * forcing a floor over an explicit value bent the knees visibly too far.
 */
function withCrouchFloor(leg: LegPose, crouch: number): LegPose {
  if (crouch <= 0.3) return leg;
  const synthesized = leg.forward === undefined && leg.kneeBend === undefined;
  const forward = leg.forward ?? crouch * 90;
  const kneeBend = leg.kneeBend ?? crouch * 130;
  return {
    ...leg,
    forward,
    kneeBend,
    // A fully synthesized leg also grounds its sole (kneeBend - forward is
    // the sole-flat dorsiflexion; 0 would leave the figure on pointe).
    // Explicit legs keep their own ankle — sitting poses fold the feet in
    // ways this formula doesn't cover.
    ankle: leg.ankle ?? (synthesized ? kneeBend - forward : undefined),
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
    // turn convention: +90 = figure faces the viewer's left (screen left).
    // The camera fronts +Z, so that is a -90° rotation about +Y.
    // bend = hip hinge: pitches the pelvis (and the whole body with it)
    // forward, spine staying straight. 'YXZ' makes the pitch happen about
    // the figure's own left-right axis (intrinsically: yaw first, then
    // pitch), so bend stays a pure forward pitch for any facing.
    hips.rotation.set((body.bend ?? 0) * DEG, -(body.turn ?? 0) * DEG, 0, 'YXZ');
    if (body.crouch) hips.position.y -= body.crouch * CROUCH_HIP_DROP;
  }

  const head = pose.head ?? {};
  resolve('head')?.rotation.set(
    (head.nod ?? 0) * DEG,
    (head.turn ?? 0) * DEG,
    -(head.tilt ?? 0) * DEG,
  );

  applyArm(resolve, 'left', pose.leftArm ?? RELAXED_ARM);
  applyArm(resolve, 'right', pose.rightArm ?? RELAXED_ARM);

  // A deep crouch bends the legs even when the LLM omitted them entirely.
  const crouch = body.crouch ?? 0;
  const leftLeg = pose.leftLeg ?? (crouch > 0.3 ? {} : null);
  const rightLeg = pose.rightLeg ?? (crouch > 0.3 ? {} : null);
  if (leftLeg) applyLeg(resolve, 'left', withCrouchFloor(leftLeg, crouch));
  if (rightLeg) applyLeg(resolve, 'right', withCrouchFloor(rightLeg, crouch));
}
