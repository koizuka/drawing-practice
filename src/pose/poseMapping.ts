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

import { Euler, Matrix4, Vector3, Quaternion } from 'three';
import type { ArmPose, BodyPose, ElbowDirection, HeadPose, LegPose, PoseJson, TargetPoint, TouchTarget } from './poseTypes';
import {
  foldBasis, foldDirection, hingeQuat, solveTwoBone, targetScale, vec3,
  type PoseRig, type TwoBoneSolution,
} from './poseIk';

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

// ---------------------------------------------------------------------------
// Placement-target IK (handAt / elbowAt / footAt / kneeAt): when a limb has a
// target, its joint rotations are solved analytically from the target instead
// of the angle fields. Needs the model's rest joint positions (PoseRig) to
// know limb lengths and where the posed shoulder / hip joint sits.
// ---------------------------------------------------------------------------

const DOWN = new Vector3(0, -1, 0);
/** Direction the shin moves under +kneeBend, in the thigh's rest frame. */
const KNEE_REST_FOLD = new Vector3(0, 0, -1);
/** Figure-frame y at/below this counts as planted on the floor (meters). */
const GROUND_EPS = 0.03;
/** Rough torso surface radius: hand targets/ends are pushed outside it. */
const TORSO_CLEARANCE = 0.13;
/** Hand/knee target separation that counts as an intended knee touch. */
const KNEE_TOUCH_DISTANCE = 0.12;
/** Planted palm: fingers point figure-front with a slight outward splay. */
const FINGER_SPLAY = 75 * DEG;

interface IkContext {
  rig: PoseRig;
  scale: number;
  /** Yaw-only body facing (targets and poles are figure-frame). */
  qYaw: Quaternion;
  /** World rotation of the hips bone (turn + bend). */
  qHips: Quaternion;
  /** Rotation applied to the spine AND the chest (each gets half the lean). */
  qHalf: Quaternion;
  /** World rotation of the chain above the upper arm (hips·spine·chest). */
  qArmParent: Quaternion;
  hipsRest: Vector3;
  /** Posed hips position (crouch drop applied). */
  hipsPos: Vector3;
  /** Figure-frame origin: the floor point below the rest hips. */
  origin: Vector3;
  /** Posed chest joint (position + world rotation), when the rig has spine+chest. */
  chestJoint: { pos: Vector3; quat: Quaternion } | null;
  /** Posed head joint (position + world rotation incl. nod/turn/tilt). */
  headJoint: { pos: Vector3; quat: Quaternion } | null;
}

function buildIkContext(rig: PoseRig, body: BodyPose, head: HeadPose): IkContext | null {
  const hips = rig.hips;
  if (!hips) return null;
  const qYaw = new Quaternion().setFromEuler(new Euler(0, -(body.turn ?? 0) * DEG, 0));
  const qHips = new Quaternion().setFromEuler(
    new Euler((body.bend ?? 0) * DEG, -(body.turn ?? 0) * DEG, 0, 'YXZ'),
  );
  const qHalf = new Quaternion().setFromEuler(new Euler(
    ((body.leanForward ?? 0) / 2) * DEG,
    ((body.twist ?? 0) / 2) * DEG,
    (-(body.leanSide ?? 0) / 2) * DEG,
  ));
  const hipsRest = vec3(hips);
  const scale = targetScale(rig);
  // hipsHeight pins the hips at an absolute floor height — unlike crouch's
  // fixed drop it can bring the body all the way down (floor sit, all-fours).
  const hipsY = body.hipsHeight !== undefined
    ? Math.max(0.03 * scale, body.hipsHeight * scale)
    : hipsRest.y - (body.crouch ?? 0) * CROUCH_HIP_DROP;
  const hipsPos = new Vector3(hipsRest.x, hipsY, hipsRest.z);
  const qChest = qHips.clone().multiply(qHalf).multiply(qHalf);
  // Posed chest/head joints (FK through hips → spine → chest → head, same
  // chain as armRootWorld): anchors for the touch presets, so a hand touching
  // the head lands on the LEANED/NODDED head, not where it stood upright.
  const sp = rig.spine;
  const ch = rig.chest;
  const hd = rig.head;
  const chestJoint = sp && ch
    ? {
        pos: vec3(sp).sub(hipsRest)
          .add(vec3(ch).sub(vec3(sp)).applyQuaternion(qHalf))
          .applyQuaternion(qHips).add(hipsPos),
        quat: qChest,
      }
    : null;
  const headJoint = chestJoint && ch && hd
    ? {
        pos: chestJoint.pos.clone().add(vec3(hd).sub(vec3(ch)).applyQuaternion(qChest)),
        quat: qChest.clone().multiply(new Quaternion().setFromEuler(new Euler(
          (head.nod ?? 0) * DEG,
          (head.turn ?? 0) * DEG,
          -(head.tilt ?? 0) * DEG,
        ))),
      }
    : null;
  return {
    rig,
    scale,
    qYaw,
    qHips,
    qHalf,
    qArmParent: qChest,
    hipsRest,
    hipsPos,
    origin: new Vector3(hips.x, 0, hips.z),
    chestJoint,
    headJoint,
  };
}

/** Figure-frame target → rig space (scale to the model, yaw with the body). */
function toWorldTarget(ctx: IkContext, t: TargetPoint): Vector3 {
  return new Vector3(t.x, t.y, t.z).multiplyScalar(ctx.scale).applyQuaternion(ctx.qYaw).add(ctx.origin);
}

/** Closest point on segment [a, b] to p. */
function closestOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  const ab = b.clone().sub(a);
  const denom = ab.lengthSq();
  if (denom < 1e-12) return a.clone();
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / denom));
  return a.clone().addScaledVector(ab, t);
}

/**
 * Posed torso center line, extended past the hips to cover the pelvis —
 * the reference surface for laying a palm against the body.
 */
function torsoAxis(ctx: IkContext): { low: Vector3; high: Vector3 } | null {
  const sp = ctx.rig.spine;
  const ch = ctx.rig.chest;
  if (!sp || !ch) return null;
  const inHips = vec3(sp).sub(ctx.hipsRest)
    .add(vec3(ch).sub(vec3(sp)).applyQuaternion(ctx.qHalf));
  const high = inHips.applyQuaternion(ctx.qHips).add(ctx.hipsPos);
  const down = ctx.hipsPos.clone().sub(high);
  if (down.lengthSq() < 1e-12) return null;
  const low = ctx.hipsPos.clone().addScaledVector(down.normalize(), 0.18 * ctx.scale);
  return { low, high };
}

/** Posed shoulder-joint position: FK through hips → spine → chest. */
function armRootWorld(ctx: IkContext, sideName: Side): Vector3 | null {
  const sp = ctx.rig.spine;
  const ch = ctx.rig.chest;
  const ua = ctx.rig[`${sideName}UpperArm`];
  if (!sp || !ch || !ua) return null;
  const inChest = vec3(ua).sub(vec3(ch)).applyQuaternion(ctx.qHalf);
  const inSpine = vec3(ch).sub(vec3(sp)).add(inChest).applyQuaternion(ctx.qHalf);
  return vec3(sp).sub(ctx.hipsRest).add(inSpine).applyQuaternion(ctx.qHips).add(ctx.hipsPos);
}

/**
 * Figure-frame handAt equivalents of the touch presets (same-side x, mirrored
 * per arm). Solved with IK when a rig is available, so they adapt to the
 * model's proportions, get the palm laid against the body, and are covered
 * by the geometric validation. The angle presets (TOUCH_PRESETS) remain the
 * no-rig fallback — notably the 'chest' angle preset folds the hand past the
 * midline INTO the chest volume, which is what prompted this conversion.
 * Sim-verified against the bundled mannequin (elbow bows out, palm on body).
 */
const TOUCH_IK_TARGETS: Record<TouchTarget, TargetPoint> = {
  hip: { x: 0.16, y: 0.92, z: 0.02 },
  // Upper SIDE of the skull (nominal head joint 1.48 + 0.05) — an ear-height
  // point rides a nodding head down to the jaw and reads as "hands in front
  // of the face" on a bowed head-clutch pose.
  head: { x: 0.10, y: 1.53, z: 0.02 },
  chest: { x: 0.03, y: 1.20, z: 0.17 },
};

/**
 * World position of a touch preset. The target is ON a body part, so it is
 * anchored to that part's posed joint — lean / bend / crouch / head nod all
 * move it along (a hand touching the head must land on the LEANED, NODDED
 * head, not where the head stood upright). For the unposed body this equals
 * the plain figure-frame placement; without the anchor joints in the rig it
 * falls back to it.
 */
function touchTargetWorld(ctx: IkContext, touch: TouchTarget, side: 1 | -1): Vector3 {
  const t = TOUCH_IK_TARGETS[touch];
  const fig: TargetPoint = { x: side * t.x, y: t.y, z: t.z };
  const anchor = touch === 'hip'
    ? { pos: ctx.hipsPos, quat: ctx.qHips, rest: ctx.hipsRest }
    : touch === 'chest'
      ? (ctx.chestJoint && ctx.rig.chest ? { ...ctx.chestJoint, rest: vec3(ctx.rig.chest) } : null)
      : (ctx.headJoint && ctx.rig.head ? { ...ctx.headJoint, rest: vec3(ctx.rig.head) } : null);
  if (!anchor) return toWorldTarget(ctx, fig);
  // Rest-space point WITHOUT the yaw — the anchor quat already carries it.
  const p0 = new Vector3(fig.x, fig.y, fig.z).multiplyScalar(ctx.scale).add(ctx.origin);
  return p0.sub(anchor.rest).applyQuaternion(anchor.quat).add(anchor.pos);
}

function applyArmIk(
  resolve: BoneResolver,
  sideName: Side,
  rawArm: ArmPose,
  ctx: IkContext,
  legs: readonly (LegPose | null | undefined)[],
): boolean {
  const side = SIDE_SIGN[sideName];
  const touchTarget = rawArm.touch ? TOUCH_IK_TARGETS[rawArm.touch] : null;
  const touchWorld = rawArm.touch ? touchTargetWorld(ctx, rawArm.touch, side) : null;
  const arm: ArmPose = touchTarget
    ? { handAt: { x: side * touchTarget.x, y: touchTarget.y, z: touchTarget.z }, elbowDirection: 'in' }
    : rawArm;
  if (!arm.handAt && !arm.elbowAt) return false;
  const upper = resolve(`${sideName}UpperArm`);
  const lower = resolve(`${sideName}LowerArm`);
  const rUA = ctx.rig[`${sideName}UpperArm`];
  const rLA = ctx.rig[`${sideName}LowerArm`];
  const rH = ctx.rig[`${sideName}Hand`];
  if (!upper || !lower || !rUA || !rLA || !rH) return false;
  const root = armRootWorld(ctx, sideName);
  if (!root) return false;
  const len1 = vec3(rLA).sub(vec3(rUA)).length();
  const len2 = vec3(rH).sub(vec3(rLA)).length();
  if (len1 < 1e-3 || len2 < 1e-3) return false;

  const planted = !!arm.handAt && arm.handAt.y <= GROUND_EPS;
  const elbowTarget = arm.elbowAt ? toWorldTarget(ctx, arm.elbowAt) : null;
  if (elbowTarget) elbowTarget.y = Math.max(elbowTarget.y, 0.04 * ctx.scale);
  const restAxis = new Vector3(side, 0, 0);
  const unYaw = ctx.qYaw.clone().invert();
  let requestedHandTarget: Vector3 | null = null;
  let kneeContactTarget: Vector3 | null = null;
  // 'back' is hyperextension in angle mode too — treat as the natural front.
  const dirName: ElbowDirection = arm.elbowDirection === 'back' ? 'front' : (arm.elbowDirection ?? 'front');

  let sol: TwoBoneSolution;
  if (arm.handAt) {
    // The torso is an obstacle, exactly like the floor: neither the target
    // nor the reach-clamped wrist may end up inside it. Push offending
    // points radially out of the torso axis to the surface clearance — a
    // below-reach target (short arms, hand covering the groin) otherwise
    // clamps the wrist onto the straight shoulder→target line, which passes
    // THROUGH the belly.
    const axis = torsoAxis(ctx);
    const clearance = TORSO_CLEARANCE * ctx.scale;
    const pushOut = (p: Vector3): Vector3 => {
      if (!axis) return p;
      const near = closestOnSegment(p, axis.low, axis.high);
      const d = p.distanceTo(near);
      if (d >= clearance) return p;
      // A point ON the axis (the worst embed) has no radial direction of its
      // own — push it out sideways, toward this arm's side of the body,
      // projected perpendicular to the (possibly tilted) axis so the full
      // clearance is radial.
      const dir = d < 1e-4
        ? foldDirection(
            new Vector3(side, 0, 0).applyQuaternion(ctx.qYaw),
            axis.high.clone().sub(axis.low).normalize(),
            FRONT.clone().applyQuaternion(ctx.qYaw),
          )
        : p.clone().sub(near).divideScalar(d);
      return near.addScaledVector(dir, clearance);
    };
    requestedHandTarget = touchWorld ?? toWorldTarget(ctx, arm.handAt);
    kneeContactTarget = !planted && arm.wrist === undefined && arm.forearmTwist === undefined
      ? legs
        .flatMap(leg => leg?.kneeAt ? [toWorldTarget(ctx, leg.kneeAt)] : [])
        .map(knee => ({ knee, distance: knee.distanceTo(requestedHandTarget!) }))
        .filter(({ distance }) => distance <= KNEE_TOUCH_DISTANCE * ctx.scale)
        .sort((a, b) => a.distance - b.distance)[0]?.knee ?? null
      : null;
    // handAt names the wrist joint, but models commonly put it at the knee
    // center when they mean "hand resting on knee". Put the wrist just above
    // and behind the knee so the palm and fingers, rather than the wrist or
    // knife-hand edge, cover its upper surface.
    let target = kneeContactTarget
      ? kneeContactTarget.clone()
          .addScaledVector(UP, 0.05 * ctx.scale)
          .addScaledVector(FRONT.clone().applyQuaternion(ctx.qYaw), -0.04 * ctx.scale)
      : requestedHandTarget.clone();
    requestedHandTarget = target.clone();
    target = pushOut(target);
    target.y = Math.max(target.y, 0.03 * ctx.scale);
    // elbowDirection keeps its meaning "the forearm folds toward" — the
    // elbow apex therefore bulges the OPPOSITE way (that's the pole).
    const dHat = target.clone().sub(root);
    if (dHat.lengthSq() < 1e-8) dHat.copy(restAxis);
    dHat.normalize();
    // Head clutch: the palm lies on the skull's side, so the elbow apex must
    // point down-front and slightly OUT. The 'in' fold used by torso touches
    // flares it sideways (over-bent wrist), and the axis-aligned 'up'/'down'
    // poles degenerate on the near-vertical shoulder→wrist axis — their
    // perpendicular residual tips inward and throws the elbow across the
    // midline (both elbows meeting in front of the face).
    const foldFig = rawArm.touch === 'head'
      ? new Vector3(-side * 0.3, 0.7, -0.65).normalize()
      : dirName === 'front'
        ? naturalBendDir(dHat.clone().applyQuaternion(unYaw))
        : elbowWorldDir(dirName, side).clone();
    const pole = foldFig.applyQuaternion(ctx.qYaw).negate();
    const opts = { root, pole, mid: elbowTarget, len1, len2, restAxis, restFold: FRONT, maxBend: 150 * DEG };
    sol = solveTwoBone({ ...opts, target });
    const pushedEnd = pushOut(sol.end.clone());
    if (pushedEnd.distanceTo(sol.end) > 1e-4) {
      // One re-aim toward the pushed-out point gets the wrist (almost) onto
      // the torso surface instead of inside it.
      sol = solveTwoBone({ ...opts, target: pushedEnd });
    }
  }
  else {
    // elbowAt only: aim the upper arm at the elbow, hinge by elbowBend.
    const boneDir = elbowTarget!.clone().sub(root);
    if (boneDir.lengthSq() < 1e-8) boneDir.copy(restAxis);
    boneDir.normalize();
    const foldFig = dirName === 'front'
      ? naturalBendDir(boneDir.clone().applyQuaternion(unYaw))
      : elbowWorldDir(dirName, side).clone();
    const fold = foldDirection(foldFig.applyQuaternion(ctx.qYaw), boneDir, FRONT.clone().applyQuaternion(ctx.qYaw));
    const bend = (arm.elbowBend ?? 0) * DEG;
    const upperWorld = foldBasis(restAxis, FRONT, boneDir, fold);
    const midLocal = hingeQuat(restAxis, FRONT, bend);
    const lowerDir = restAxis.clone().applyQuaternion(upperWorld.clone().multiply(midLocal));
    sol = { upperWorld, midLocal, bend, mid: elbowTarget!, end: elbowTarget!.clone().addScaledVector(lowerDir, len2) };
  }

  upper.quaternion.copy(ctx.qArmParent.clone().invert().multiply(sol.upperWorld));
  lower.quaternion.copy(sol.midLocal);

  const hand = resolve(`${sideName}Hand`);
  if (hand) {
    const forearmWorld = sol.upperWorld.clone().multiply(sol.midLocal);
    const forearmDir = sol.end.clone().sub(sol.mid).normalize();
    const autoOrient = arm.wrist === undefined && arm.forearmTwist === undefined;
    const torso = autoOrient && !planted ? torsoAxis(ctx) : null;
    const onBody = torso ? closestOnSegment(sol.end, torso.low, torso.high) : null;
    if (planted && autoOrient && forearmDir.y <= -0.2) {
      // Planted palm: flat on the floor (world rest orientation is palm-down),
      // fingers toward the figure's front with a slight outward splay.
      const flat = ctx.qYaw.clone().multiply(new Quaternion().setFromAxisAngle(UP, -side * FINGER_SPLAY));
      hand.quaternion.copy(forearmWorld.invert().multiply(flat));
    }
    else if (kneeContactTarget) {
      // A hand target just above a knee means the palm rests ON the knee.
      // Aim the palm normal toward it instead of leaving the hand's T-pose
      // edge facing the knee (the characteristic "knife-hand" artifact).
      const normal = kneeContactTarget.clone().sub(requestedHandTarget!);
      if (normal.lengthSq() < 1e-4) normal.copy(DOWN);
      else normal.normalize();
      const fingers = foldDirection(FRONT.clone().applyQuaternion(ctx.qYaw), normal, forearmDir);
      const handWorld = foldBasis(new Vector3(side, 0, 0), new Vector3(0, -1, 0), fingers, normal);
      hand.quaternion.copy(forearmWorld.invert().multiply(handWorld));
    }
    // "Touching" = within a small tolerance of the torso SURFACE (the bust
    // extends past the nominal clearance radius, hence the 5cm allowance).
    else if (onBody && onBody.distanceTo(sol.end) < (TORSO_CLEARANCE + 0.05) * ctx.scale
      && onBody.distanceTo(sol.end) > 1e-3) {
      // Hand touching the figure's own torso: lay the palm against the body
      // (normal toward the torso axis — the same physical rule as a palm
      // planted on the floor), fingers following the forearm's direction.
      const normal = onBody.clone().sub(sol.end).normalize();
      const fingers = foldDirection(forearmDir, normal, DOWN);
      const handWorld = foldBasis(new Vector3(side, 0, 0), new Vector3(0, -1, 0), fingers, normal);
      hand.quaternion.copy(forearmWorld.invert().multiply(handWorld));
    }
    else {
      hand.rotation.set(-(arm.forearmTwist ?? 0) * DEG, 0, side * (arm.wrist ?? 0) * DEG, 'XYZ');
    }
  }
  return true;
}

function applyLegIk(resolve: BoneResolver, sideName: Side, leg: LegPose, ctx: IkContext): boolean {
  if (!leg.footAt && !leg.kneeAt) return false;
  const side = SIDE_SIGN[sideName];
  const upper = resolve(`${sideName}UpperLeg`);
  const lower = resolve(`${sideName}LowerLeg`);
  const rUL = ctx.rig[`${sideName}UpperLeg`];
  const rLL = ctx.rig[`${sideName}LowerLeg`];
  const rF = ctx.rig[`${sideName}Foot`];
  if (!upper || !lower || !rUL || !rLL || !rF) return false;
  const root = vec3(rUL).sub(ctx.hipsRest).applyQuaternion(ctx.qHips).add(ctx.hipsPos);
  const len1 = vec3(rLL).sub(vec3(rUL)).length();
  const len2 = vec3(rF).sub(vec3(rLL)).length();
  if (len1 < 1e-3 || len2 < 1e-3) return false;

  const soleHeight = Math.max(0.02, rF.y);
  const planted = !!leg.footAt && leg.footAt.y <= GROUND_EPS;
  const kneeTarget = leg.kneeAt ? toWorldTarget(ctx, leg.kneeAt) : null;
  // The knee has its own radius — never solve it through the floor.
  if (kneeTarget) kneeTarget.y = Math.max(kneeTarget.y, 0.05 * ctx.scale);

  // kneeDirection = which way the knee APEX points (figure frame).
  const poleFig = leg.kneeDirection === 'out'
    ? new Vector3(side, 0, 0)
    : leg.kneeDirection === 'in'
      ? new Vector3(-side, 0, 0)
      : new Vector3(0, 0, 1);
  const pole = poleFig.applyQuaternion(ctx.qYaw);

  let sol: TwoBoneSolution;
  if (leg.footAt) {
    const target = toWorldTarget(ctx, leg.footAt);
    // A planted ankle sits at its rest (sole-offset) height.
    target.y = Math.max(target.y, planted ? soleHeight : 0.03 * ctx.scale);
    // For a planted sole the ankle contact is authoritative. Approximate
    // kneeAt coordinates rarely match a particular VRM's two bone lengths;
    // treating that knee as a hard intermediate target makes the fixed-length
    // shin stop short of or overshoot through the floor. Use it as the bend
    // pole instead. Non-planted kneeling/sitting legs keep the hard knee so a
    // vertical supporting thigh remains pinned where requested.
    const solvePole = planted && kneeTarget ? kneeTarget.clone().sub(root) : pole;
    sol = solveTwoBone({
      root,
      target,
      pole: solvePole,
      mid: planted ? null : kneeTarget,
      len1,
      len2,
      restAxis: DOWN,
      restFold: KNEE_REST_FOLD,
      maxBend: 160 * DEG,
    });
  }
  else {
    // kneeAt only: aim the thigh at the knee, hinge by kneeBend. The shin
    // folds toward the figure's back by default (kneeling, sitting).
    const boneDir = kneeTarget!.clone().sub(root);
    if (boneDir.lengthSq() < 1e-8) boneDir.copy(DOWN);
    boneDir.normalize();
    const fold = foldDirection(new Vector3(0, 0, -1).applyQuaternion(ctx.qYaw), boneDir, DOWN);
    const bend = (leg.kneeBend ?? 0) * DEG;
    const upperWorld = foldBasis(DOWN, KNEE_REST_FOLD, boneDir, fold);
    const midLocal = hingeQuat(DOWN, KNEE_REST_FOLD, bend);
    const lowerDir = DOWN.clone().applyQuaternion(upperWorld.clone().multiply(midLocal));
    sol = { upperWorld, midLocal, bend, mid: kneeTarget!, end: kneeTarget!.clone().addScaledVector(lowerDir, len2) };
  }

  upper.quaternion.copy(ctx.qHips.clone().invert().multiply(sol.upperWorld));
  lower.quaternion.copy(sol.midLocal);

  const foot = resolve(`${sideName}Foot`);
  if (foot) {
    const shinWorld = sol.upperWorld.clone().multiply(sol.midLocal);
    const shinDir = sol.end.clone().sub(sol.mid).normalize();
    if (planted && leg.ankle === undefined && shinDir.y <= -0.5) {
      // Planted sole: flat on the floor, toes figure-front (the foot's world
      // rest orientation) — only reachable with a reasonably upright shin.
      foot.quaternion.copy(shinWorld.invert().multiply(ctx.qYaw));
    }
    else {
      foot.rotation.set(-(leg.ankle ?? 0) * DEG, 0, 0);
    }
  }
  return true;
}

function applyArm(resolve: BoneResolver, sideName: Side, arm: ArmPose): void {
  // A target-only arm lands here when the IK path is unavailable (no rig,
  // model missing bones). Without this guard `raise ?? 90` would render it as
  // a T-pose arm; hang it relaxed instead, but keep any explicit fields the
  // pose did provide (elbowBend / wrist / forearmTwist are legal overrides
  // alongside targets).
  const targetOnly = !arm.touch && (arm.handAt || arm.elbowAt)
    && arm.raise === undefined && arm.forward === undefined;
  const a = arm.touch
    ? TOUCH_PRESETS[arm.touch]
    : targetOnly
      ? { ...arm, raise: RELAXED_ARM.raise, forward: RELAXED_ARM.forward, elbowBend: arm.elbowBend ?? RELAXED_ARM.elbowBend }
      : arm;
  const side = SIDE_SIGN[sideName];
  const raise = (a.raise ?? 90) * DEG;
  const fwd = (a.forward ?? 0) * DEG;
  const dir = new Vector3(
    side * Math.sin(raise) * Math.cos(fwd),
    -Math.cos(raise),
    Math.sin(raise) * Math.sin(fwd),
  ).normalize();
  const upper = resolve(`${sideName}UpperArm`);
  if (upper) {
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
      // 'back' is rendered as the natural front fold: for every arm
      // orientation its projection lands (near-)opposite the twist-pinned
      // flexor direction, i.e. pure hyperextension — a backward-bent elbow
      // (reported on running poses, where models used 'back' for the
      // rear-swung arm). A hand goes behind the body by swinging the whole
      // arm back (negative "forward"), never by reversing the elbow. Kept
      // in the enum so stored poses stay parseable.
      const requested = a.elbowDirection ?? 'front';
      const world = elbowWorldDir(requested === 'back' ? 'front' : requested, side);
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
  //
  // With no explicit forearmTwist, the coronal-frame default above leaves a
  // fully RAISED arm palm-OUT (the basis math follows a sideways raise). An
  // arm raised the ordinary way — through the front — ends with the palm
  // facing INWARD, so auto-roll the palm in proportion to the arm's
  // elevation: hanging / T-pose / straight-forward arms stay unchanged
  // (already natural), straight up gets the full 180 (palm toward the head).
  // Explicit forearmTwist and the visually tuned touch presets override it.
  const autoTwist = arm.touch ? 0 : Math.max(0, dir.y) * 180;
  resolve(`${sideName}Hand`)?.rotation.set(
    -(a.forearmTwist ?? autoTwist) * DEG,
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
 *
 * `rig` (rest joint positions of the actual model) enables the placement-
 * target IK path; without it targets are ignored and the angle fields apply.
 */
export function applyPose(resolve: BoneResolver, resetPose: () => void, pose: PoseJson, rig?: PoseRig | null): void {
  resetPose();

  const body = pose.body ?? {};
  const halfX = ((body.leanForward ?? 0) / 2) * DEG;
  const halfY = ((body.twist ?? 0) / 2) * DEG;
  const halfZ = (-(body.leanSide ?? 0) / 2) * DEG;
  resolve('spine')?.rotation.set(halfX, halfY, halfZ);
  resolve('chest')?.rotation.set(halfX, halfY, halfZ);

  const ctx = rig ? buildIkContext(rig, body, pose.head ?? {}) : null;

  const hips = resolve('hips');
  if (hips) {
    // turn convention: +90 = figure faces the viewer's left (screen left).
    // The camera fronts +Z, so that is a -90° rotation about +Y.
    // bend = hip hinge: pitches the pelvis (and the whole body with it)
    // forward, spine staying straight. 'YXZ' makes the pitch happen about
    // the figure's own left-right axis (intrinsically: yaw first, then
    // pitch), so bend stays a pure forward pitch for any facing.
    hips.rotation.set((body.bend ?? 0) * DEG, -(body.turn ?? 0) * DEG, 0, 'YXZ');
    // With a rig the context already resolved hipsHeight vs crouch; without
    // one only the crouch drop is available (hipsHeight needs the rest rig).
    if (ctx) hips.position.y -= ctx.hipsRest.y - ctx.hipsPos.y;
    else if (body.crouch) hips.position.y -= body.crouch * CROUCH_HIP_DROP;
  }

  const head = pose.head ?? {};
  resolve('head')?.rotation.set(
    (head.nod ?? 0) * DEG,
    (head.turn ?? 0) * DEG,
    -(head.tilt ?? 0) * DEG,
  );

  const leftArm = pose.leftArm ?? RELAXED_ARM;
  const rightArm = pose.rightArm ?? RELAXED_ARM;
  const legs = [pose.leftLeg, pose.rightLeg] as const;
  if (!(ctx && applyArmIk(resolve, 'left', leftArm, ctx, legs))) applyArm(resolve, 'left', leftArm);
  if (!(ctx && applyArmIk(resolve, 'right', rightArm, ctx, legs))) applyArm(resolve, 'right', rightArm);

  // A deep crouch bends the legs even when the LLM omitted them entirely.
  const crouch = body.crouch ?? 0;
  const leftLeg = pose.leftLeg ?? (crouch > 0.3 ? {} : null);
  const rightLeg = pose.rightLeg ?? (crouch > 0.3 ? {} : null);
  if (leftLeg && !(ctx && applyLegIk(resolve, 'left', leftLeg, ctx))) {
    applyLeg(resolve, 'left', withCrouchFloor(leftLeg, crouch));
  }
  if (rightLeg && !(ctx && applyLegIk(resolve, 'right', rightLeg, ctx))) {
    applyLeg(resolve, 'right', withCrouchFloor(rightLeg, crouch));
  }
}
