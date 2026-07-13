import { describe, it, expect, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { applyPose, TOUCH_PRESETS, type BoneResolver, type PoseBoneName } from './poseMapping';
import type { PoseRig } from './poseIk';

const DEG = Math.PI / 180;

function makeRig() {
  const bones = new Map<PoseBoneName, Object3D>();
  const names: PoseBoneName[] = [
    'hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];
  for (const name of names) bones.set(name, new Object3D());
  const resolve: BoneResolver = name => bones.get(name) ?? null;
  const resetPose = vi.fn(() => {
    for (const bone of bones.values()) {
      bone.rotation.set(0, 0, 0);
      bone.position.set(0, 0, 0);
    }
  });
  return { bones, resolve, resetPose };
}

/** Direction the given upper-limb bone points after rotation, from a T-pose rest direction. */
function limbDirection(bone: Object3D, rest: Vector3): Vector3 {
  return rest.clone().applyQuaternion(bone.quaternion);
}

describe('applyPose', () => {
  it('always resets the pose first', () => {
    const { resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {});
    expect(resetPose).toHaveBeenCalledTimes(1);
  });

  it('absent arms default to relaxed hanging, not the T-pose rest', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {});
    const left = limbDirection(bones.get('leftUpperArm')!, new Vector3(1, 0, 0));
    const right = limbDirection(bones.get('rightUpperArm')!, new Vector3(-1, 0, 0));
    // Mostly downward, slightly away from the body so it doesn't clip.
    expect(left.y).toBeLessThan(-0.9);
    expect(right.y).toBeLessThan(-0.9);
    expect(left.x).toBeGreaterThan(0.05);
    expect(right.x).toBeLessThan(-0.05);
  });

  it('raise=90/forward=0 keeps the arm at the T-pose direction', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftArm: { raise: 90, forward: 0 } });
    const dir = limbDirection(bones.get('leftUpperArm')!, new Vector3(1, 0, 0));
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(0);
  });

  it('raise=0 points the arm straight down, raise=180 straight up', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftArm: { raise: 0 }, rightArm: { raise: 180 } });
    const down = limbDirection(bones.get('leftUpperArm')!, new Vector3(1, 0, 0));
    expect(down.y).toBeCloseTo(-1);
    const up = limbDirection(bones.get('rightUpperArm')!, new Vector3(-1, 0, 0));
    expect(up.y).toBeCloseTo(1);
  });

  it('raise=90/forward=90 points the arm toward the front (+Z)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { rightArm: { raise: 90, forward: 90 } });
    const dir = limbDirection(bones.get('rightUpperArm')!, new Vector3(-1, 0, 0));
    expect(dir.z).toBeCloseTo(1);
  });

  it.each([
    ['front', 'left', { y: -90 * DEG, z: 0 }],
    ['front', 'right', { y: 90 * DEG, z: 0 }],
    // 'back' is a hyperextension request — rendered as the front fold (an
    // elbow never bends backward; see the guard in applyArm).
    ['back', 'left', { y: -90 * DEG, z: 0 }],
    ['down', 'left', { y: 0, z: -90 * DEG }],
    ['up', 'left', { y: 0, z: 90 * DEG }],
  ] as const)('elbowDirection %s (%s arm) rotates the forearm on the expected axis', (direction, side, expected) => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      [`${side}Arm`]: { elbowBend: 90, elbowDirection: direction },
    });
    const lower = bones.get(`${side}LowerArm`)!;
    expect(lower.rotation.y).toBeCloseTo(expected.y);
    expect(lower.rotation.z).toBeCloseTo(expected.z);
  });

  it('never reverses the elbow on a rear-swung arm, even when the pose asks for "back"', () => {
    // Running rear arm: models used to emit elbowDirection 'back' here, whose
    // world direction projects (near-)opposite the flexor side for every arm
    // orientation — the forearm folded up-backward as a hyperextended elbow.
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { raise: 25, forward: -40, elbowBend: 90, elbowDirection: 'back' },
    });
    const upper = bones.get('leftUpperArm')!;
    const worldQuat = upper.quaternion.clone().multiply(bones.get('leftLowerArm')!.quaternion);
    const forearmDir = new Vector3(1, 0, 0).applyQuaternion(worldQuat);
    const upperDir = limbDirection(upper, new Vector3(1, 0, 0));
    // The fold component (forearm direction minus its along-humerus part)
    // must point toward the world front — the anatomically possible flexion —
    // not behind the body.
    const fold = forearmDir.clone().addScaledVector(upperDir, -forearmDir.dot(upperDir));
    expect(fold.z).toBeGreaterThan(0.5);
  });

  it('pins the upper-arm twist so the local front-fold plane faces the natural bend direction', () => {
    // Arm raised and swung forward — shortest-arc rotation would leave the
    // fold plane pointing somewhere arbitrary here.
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftArm: { raise: 60, forward: 70 } });
    const upper = bones.get('leftUpperArm')!;
    const dir = limbDirection(upper, new Vector3(1, 0, 0));
    // Expected natural bend dir: world front projected off the limb direction.
    const expected = new Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
    const localFront = new Vector3(0, 0, 1).applyQuaternion(upper.quaternion);
    expect(localFront.dot(expected)).toBeCloseTo(1, 5);
  });

  it('falls back to an upward curl when the arm points straight forward', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { rightArm: { raise: 90, forward: 90 } });
    const upper = bones.get('rightUpperArm')!;
    const localFront = new Vector3(0, 0, 1).applyQuaternion(upper.quaternion);
    expect(localFront.y).toBeCloseTo(1, 5);
  });

  it('elbowDirection keeps its world meaning on a rotated arm ("down" folds the forearm downward)', () => {
    // Arm swung diagonally forward — the shortest-arc-era local axes would
    // fold somewhere else here; the world-direction semantics must hold.
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftArm: { raise: 90, forward: 45, elbowBend: 90, elbowDirection: 'down' } });
    const worldQuat = bones.get('leftUpperArm')!.quaternion.clone()
      .multiply(bones.get('leftLowerArm')!.quaternion);
    const forearmDir = new Vector3(1, 0, 0).applyQuaternion(worldQuat);
    expect(forearmDir.y).toBeCloseTo(-1, 5);
  });

  it('maps wrist to a side-signed hand Z rotation (+ = extension lifts the fingertips)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { raise: 90, wrist: 90 },
      rightArm: { raise: 90, wrist: -30 },
    });
    expect(bones.get('leftHand')!.rotation.z).toBeCloseTo(90 * DEG);
    expect(bones.get('rightHand')!.rotation.z).toBeCloseTo(30 * DEG);
    // T-pose + full extension: fingertips point straight up on the left.
    const fingers = limbDirection(bones.get('leftHand')!, new Vector3(1, 0, 0));
    expect(fingers.y).toBeCloseTo(1);
  });

  it('forearmTwist + rolls the palm toward the front on both sides', () => {
    const { bones, resolve, resetPose } = makeRig();
    const arm = { raise: 90, forearmTwist: 90 };
    applyPose(resolve, resetPose, { leftArm: arm, rightArm: arm });
    // Palm-down T-pose rest: the palm normal is -Y; +90 twist must face it +Z.
    for (const side of ['left', 'right'] as const) {
      const palm = limbDirection(bones.get(`${side}Hand`)!, new Vector3(0, -1, 0));
      expect(palm.z).toBeCloseTo(1);
    }
  });

  it('the wrist hinge rides on the pronated frame (extension folds toward the back of the hand)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { raise: 90, forearmTwist: 90, wrist: 90 },
    });
    // Twist first: palm faces +Z, so the hinge axis is now vertical.
    // Extension then folds the hand toward its dorsal side: fingers point
    // back (-Z) and the palm normal swings to +X (along the arm line). If
    // the hinge ignored the twist, the fingers would fold upward instead.
    const hand = bones.get('leftHand')!;
    expect(limbDirection(hand, new Vector3(1, 0, 0)).z).toBeCloseTo(-1);
    expect(limbDirection(hand, new Vector3(0, -1, 0)).x).toBeCloseTo(1);
  });

  it('touch replaces the angle fields with the preset', () => {
    const { bones, resolve, resetPose } = makeRig();
    const withTouch = makeRig();
    applyPose(resolve, resetPose, { leftArm: TOUCH_PRESETS.hip });
    applyPose(withTouch.resolve, withTouch.resetPose, { leftArm: { touch: 'hip', raise: 180 } });
    expect(withTouch.bones.get('leftUpperArm')!.quaternion.toArray())
      .toEqual(bones.get('leftUpperArm')!.quaternion.toArray());
  });

  it('elbowDirection "in" folds the forearm toward the midline on both sides', () => {
    const { bones, resolve, resetPose } = makeRig();
    const arm = { raise: 50, forward: 80, elbowBend: 90, elbowDirection: 'in' as const };
    applyPose(resolve, resetPose, { leftArm: arm, rightArm: arm });
    // World forearm direction = upper ∘ lower applied to the forearm rest
    // direction (side, 0, 0). Medial means -X for the left arm, +X for the
    // right (model's left is +X).
    const forearmWorld = (side: 'left' | 'right', sign: number) => new Vector3(sign, 0, 0)
      .applyQuaternion(bones.get(`${side}LowerArm` as const)!.quaternion)
      .applyQuaternion(bones.get(`${side}UpperArm` as const)!.quaternion);
    expect(forearmWorld('left', 1).x).toBeLessThan(-0.3);
    expect(forearmWorld('right', -1).x).toBeGreaterThan(0.3);
  });

  it('shinTwist reorients the foot outward without moving the shin direction', () => {
    const plain = makeRig();
    applyPose(plain.resolve, plain.resetPose, { leftLeg: { kneeBend: 145 } });
    const twisted = makeRig();
    applyPose(twisted.resolve, twisted.resetPose, { leftLeg: { kneeBend: 145, shinTwist: 30 } });

    const shinDir = (rig: ReturnType<typeof makeRig>) =>
      limbDirection(rig.bones.get('leftLowerLeg')!, new Vector3(0, -1, 0));
    // The shin's own axis is unchanged by the twist…
    expect(shinDir(twisted).distanceTo(shinDir(plain))).toBeLessThan(1e-6);
    // …but the toe direction swings outward (+X for the left leg).
    const toeDir = (rig: ReturnType<typeof makeRig>) =>
      limbDirection(rig.bones.get('leftLowerLeg')!, new Vector3(0, 0, 1));
    expect(toeDir(plain).x).toBeCloseTo(0);
    expect(toeDir(twisted).x).toBeGreaterThan(0.3);
  });

  it('shinTwist + is external (outward) on both sides', () => {
    const { bones, resolve, resetPose } = makeRig();
    const leg = { kneeBend: 145, shinTwist: 30 };
    applyPose(resolve, resetPose, { leftLeg: leg, rightLeg: leg });
    expect(bones.get('leftLowerLeg')!.rotation.y).toBeCloseTo(30 * DEG);
    expect(bones.get('rightLowerLeg')!.rotation.y).toBeCloseTo(-30 * DEG);
  });

  it('maps ankle to a sign-flipped foot X rotation (+ = dorsiflexion)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftLeg: { ankle: 20 },
      rightLeg: { ankle: -30 },
    });
    expect(bones.get('leftFoot')!.rotation.x).toBeCloseTo(-20 * DEG);
    expect(bones.get('rightFoot')!.rotation.x).toBeCloseTo(30 * DEG);
  });

  it('respects an explicit shallow kneeBend under deep crouch (knee-hug sitting)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 1 },
      leftLeg: { forward: 115, kneeBend: 115 },
    });
    // The crouch floor only fills in OMITTED values — an explicit 115 must
    // not be forced up to crouch*130.
    expect(bones.get('leftLowerLeg')!.rotation.x).toBeCloseTo(115 * DEG);
  });

  it('maps leg forward/spread/kneeBend to hip and knee rotations', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftLeg: { forward: 90, spread: 20, kneeBend: 45 } });
    const upper = bones.get('leftUpperLeg')!;
    expect(upper.rotation.x).toBeCloseTo(-90 * DEG);
    expect(upper.rotation.z).toBeCloseTo(20 * DEG);
    expect(bones.get('leftLowerLeg')!.rotation.x).toBeCloseTo(45 * DEG);
  });

  it('maps leg rotation to a side-signed Y twist of the upper leg', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftLeg: { rotation: 70 },
      rightLeg: { rotation: 70 },
    });
    expect(bones.get('leftUpperLeg')!.rotation.y).toBeCloseTo(70 * DEG);
    expect(bones.get('rightUpperLeg')!.rotation.y).toBeCloseTo(-70 * DEG);
    // 'XZY' applies the twist before spread/flexion — see applyLeg.
    expect(bones.get('leftUpperLeg')!.rotation.order).toBe('XZY');
  });

  it('cross-legged values point the kneecap outward, not forward', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftLeg: { forward: 90, spread: 30, rotation: 70, kneeBend: 140 },
    });
    // Kneecap rest direction is +Z (faces the viewer). After external
    // rotation it must face the figure's left (+X), and the thigh must keep
    // its outward abduction instead of swinging back to the front.
    const kneecap = limbDirection(bones.get('leftUpperLeg')!, new Vector3(0, 0, 1));
    expect(kneecap.x).toBeGreaterThan(0.7);
    const thigh = limbDirection(bones.get('leftUpperLeg')!, new Vector3(0, -1, 0));
    expect(thigh.x).toBeCloseTo(Math.sin(30 * DEG), 1);
    expect(thigh.z).toBeGreaterThan(0.7);
  });

  it('body.bend pitches the hips forward with the spine untouched', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { bend: 90 } });
    expect(bones.get('hips')!.rotation.x).toBeCloseTo(90 * DEG);
    expect(bones.get('spine')!.rotation.x).toBeCloseTo(0);
    expect(bones.get('chest')!.rotation.x).toBeCloseTo(0);
  });

  it('body.bend stays a pure forward pitch when combined with turn', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { bend: 90, turn: 90 } });
    const hips = bones.get('hips')!;
    expect(hips.rotation.order).toBe('YXZ');
    // The body's own down axis (-Y at rest) must pitch toward the FIGURE's
    // front: facing viewer-left (turn +90 → figure front = world -X), a 90°
    // hip hinge sends the legs' rest direction to world +X (behind the figure).
    const down = new Vector3(0, -1, 0).applyQuaternion(hips.quaternion);
    expect(down.x).toBeCloseTo(1);
    expect(down.y).toBeCloseTo(0);
  });

  it('body.bend 180 fully inverts the body (handstand)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { bend: 180 },
      leftArm: { raise: 180, forward: 0 },
      leftLeg: { forward: 0, kneeBend: 0 },
    });
    const hipsQuat = bones.get('hips')!.quaternion;
    // Legs point world-up…
    const legDir = new Vector3(0, -1, 0)
      .applyQuaternion(bones.get('leftUpperLeg')!.quaternion)
      .applyQuaternion(hipsQuat);
    expect(legDir.y).toBeCloseTo(1);
    // …and the overhead arm points world-down (spine/chest are unrotated, so
    // composing hips ∘ upperArm covers the whole chain).
    const armDir = new Vector3(1, 0, 0)
      .applyQuaternion(bones.get('leftUpperArm')!.quaternion)
      .applyQuaternion(hipsQuat);
    expect(armDir.y).toBeCloseTo(-1);
  });

  it('body.turn +90 (faces viewer-left) rotates the hips by -90°', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { turn: 90 } });
    expect(bones.get('hips')!.rotation.y).toBeCloseTo(-90 * DEG);
  });

  it('crouch lowers the hips and floors the leg angles, even with legs omitted', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { crouch: 0.9 } });
    expect(bones.get('hips')!.position.y).toBeCloseTo(-0.9 * 0.35);
    expect(bones.get('leftUpperLeg')!.rotation.x).toBeCloseTo(-(0.9 * 90) * DEG);
    expect(bones.get('leftLowerLeg')!.rotation.x).toBeCloseTo(0.9 * 130 * DEG);
    // A fully synthesized leg also grounds the sole: ankle = kneeBend -
    // forward (dorsiflexion, foot rotation.x is sign-flipped) — 0 would put
    // the figure on pointe.
    expect(bones.get('leftFoot')!.rotation.x).toBeCloseTo(-(0.9 * 40) * DEG);
  });

  it('does not synthesize an ankle for a leg with explicit angles', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 1 },
      leftLeg: { forward: 100, kneeBend: 145 },
    });
    expect(bones.get('leftFoot')!.rotation.x).toBeCloseTo(0);
  });

  it('does not floor legs beyond explicitly larger angles', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { crouch: 0.5 }, leftLeg: { kneeBend: 150 } });
    expect(bones.get('leftLowerLeg')!.rotation.x).toBeCloseTo(150 * DEG);
  });

  it('splits torso lean between spine and chest, and tolerates a missing chest', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { leanForward: 40 } });
    expect(bones.get('spine')!.rotation.x).toBeCloseTo(20 * DEG);
    expect(bones.get('chest')!.rotation.x).toBeCloseTo(20 * DEG);

    const noChest = makeRig();
    noChest.bones.delete('chest');
    expect(() =>
      applyPose(noChest.resolve, noChest.resetPose, { body: { leanForward: 40 } }),
    ).not.toThrow();
  });

  it('maps head nod/turn/tilt with the documented signs', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { head: { nod: 10, turn: 20, tilt: 30 } });
    const head = bones.get('head')!;
    expect(head.rotation.x).toBeCloseTo(10 * DEG);
    expect(head.rotation.y).toBeCloseTo(20 * DEG);
    expect(head.rotation.z).toBeCloseTo(-30 * DEG);
  });
});

// ---------------------------------------------------------------------------
// Placement-target IK path. The synthetic rest rig is 1.60m tall (head 1.48 +
// the 0.12 head-top allowance) so targetScale is exactly 1 and target
// coordinates equal rig coordinates.
// ---------------------------------------------------------------------------

const v = (x: number, y: number, z: number) => ({ x, y, z });
const REST: PoseRig = {
  hips: v(0, 0.80, 0),
  spine: v(0, 0.90, 0),
  chest: v(0, 1.05, 0),
  head: v(0, 1.48, 0),
  leftUpperArm: v(0.13, 1.30, 0), rightUpperArm: v(-0.13, 1.30, 0),
  leftLowerArm: v(0.41, 1.30, 0), rightLowerArm: v(-0.41, 1.30, 0), // upper arm 0.28
  leftHand: v(0.66, 1.30, 0), rightHand: v(-0.66, 1.30, 0), // forearm 0.25
  leftUpperLeg: v(0.09, 0.75, 0), rightUpperLeg: v(-0.09, 0.75, 0),
  leftLowerLeg: v(0.09, 0.38, 0), rightLowerLeg: v(-0.09, 0.38, 0), // thigh 0.37
  leftFoot: v(0.09, 0.07, 0), rightFoot: v(-0.09, 0.07, 0), // shin 0.31
};
const CROUCH_DROP = 0.35;

type Bones = Map<PoseBoneName, Object3D>;

/** FK matching the production chain assumptions (hips → limbs, torso identity unless leaned). */
function leftAnkleWorld(bones: Bones, crouch = 0): Vector3 {
  const qHips = bones.get('hips')!.quaternion;
  const hipsPos = new Vector3(0, 0.80 - crouch * CROUCH_DROP, 0);
  const hipJoint = hipsPos.clone().add(new Vector3(0.09, -0.05, 0).applyQuaternion(qHips));
  const qThigh = qHips.clone().multiply(bones.get('leftUpperLeg')!.quaternion);
  const knee = hipJoint.clone().add(new Vector3(0, -0.37, 0).applyQuaternion(qThigh));
  const qShin = qThigh.clone().multiply(bones.get('leftLowerLeg')!.quaternion);
  return knee.add(new Vector3(0, -0.31, 0).applyQuaternion(qShin));
}

function leftWristWorld(bones: Bones, crouch = 0): Vector3 {
  const qHips = bones.get('hips')!.quaternion;
  const hipsPos = new Vector3(0, 0.80 - crouch * CROUCH_DROP, 0);
  const shoulder = hipsPos.clone().add(new Vector3(0.13, 0.50, 0).applyQuaternion(qHips));
  const qUpper = qHips.clone().multiply(bones.get('leftUpperArm')!.quaternion);
  const elbow = shoulder.clone().add(new Vector3(0.28, 0, 0).applyQuaternion(qUpper));
  const qLower = qUpper.clone().multiply(bones.get('leftLowerArm')!.quaternion);
  return elbow.add(new Vector3(0.25, 0, 0).applyQuaternion(qLower));
}

describe('applyPose placement targets', () => {
  it('footAt places the ankle at the target (planted y snaps to the sole height)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 0.3 },
      leftLeg: { footAt: { x: 0.09, y: 0, z: 0.25 } },
    }, REST);
    const ankle = leftAnkleWorld(bones, 0.3);
    expect(ankle.x).toBeCloseTo(0.09, 3);
    expect(ankle.y).toBeCloseTo(0.07, 3); // rest sole offset, not 0
    expect(ankle.z).toBeCloseTo(0.25, 3);
  });

  it('a planted foot lands sole-flat, toes forward', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 0.3 },
      leftLeg: { footAt: { x: 0.09, y: 0, z: 0.25 } },
    }, REST);
    const footWorld = bones.get('hips')!.quaternion.clone()
      .multiply(bones.get('leftUpperLeg')!.quaternion)
      .multiply(bones.get('leftLowerLeg')!.quaternion)
      .multiply(bones.get('leftFoot')!.quaternion);
    expect(new Vector3(0, 1, 0).applyQuaternion(footWorld).y).toBeCloseTo(1, 5);
    expect(new Vector3(0, 0, 1).applyQuaternion(footWorld).z).toBeCloseTo(1, 5);
  });

  it('the knee bulges toward the figure front by default', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 0.5 },
      leftLeg: { footAt: { x: 0.09, y: 0, z: 0 } },
    }, REST);
    const qThigh = bones.get('hips')!.quaternion.clone().multiply(bones.get('leftUpperLeg')!.quaternion);
    const knee = new Vector3(0.09, 0.75 - 0.5 * CROUCH_DROP, 0)
      .add(new Vector3(0, -0.37, 0).applyQuaternion(qThigh));
    expect(knee.z).toBeGreaterThan(0.05);
  });

  it('kneeAt + footAt pin a folded leg (kneeling): knee toward its target, ankle behind', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { crouch: 1 },
      leftLeg: { kneeAt: { x: 0.09, y: 0.05, z: 0.1 }, footAt: { x: 0.09, y: 0.04, z: -0.2 }, ankle: -50 },
    }, REST);
    const qHips = bones.get('hips')!.quaternion;
    const hipJoint = new Vector3(0, 0.45, 0).add(new Vector3(0.09, -0.05, 0).applyQuaternion(qHips));
    const qThigh = qHips.clone().multiply(bones.get('leftUpperLeg')!.quaternion);
    const knee = hipJoint.clone().add(new Vector3(0, -0.37, 0).applyQuaternion(qThigh));
    // Knee on the clamped ray toward its target.
    const wantDir = new Vector3(0.09, 0.05, 0.1).sub(hipJoint).normalize();
    expect(knee.clone().sub(hipJoint).normalize().distanceTo(wantDir)).toBeLessThan(1e-4);
    // Ankle behind the knee, and the explicit ankle hinge is respected.
    const ankle = leftAnkleWorld(bones, 1);
    expect(ankle.z).toBeLessThan(knee.z);
    expect(bones.get('leftFoot')!.rotation.x).toBeCloseTo(50 * DEG);
  });

  it('handAt reaches the target with the body pitched forward (all-fours arm)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { bend: 80, crouch: 1 },
      leftArm: { handAt: { x: 0.15, y: 0, z: 0.49 } },
    }, REST);
    const wrist = leftWristWorld(bones, 1);
    expect(wrist.x).toBeCloseTo(0.15, 2);
    expect(wrist.y).toBeCloseTo(0.03, 2); // planted wrist floor offset
    expect(wrist.z).toBeCloseTo(0.49, 2);
  });

  it('a planted palm lies flat with the fingers aimed forward', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { bend: 80, crouch: 1 },
      leftArm: { handAt: { x: 0.15, y: 0, z: 0.49 } },
    }, REST);
    const handWorld = bones.get('hips')!.quaternion.clone()
      .multiply(bones.get('leftUpperArm')!.quaternion)
      .multiply(bones.get('leftLowerArm')!.quaternion)
      .multiply(bones.get('leftHand')!.quaternion);
    // Palm normal stays floor-down, fingers point mostly figure-front.
    expect(new Vector3(0, -1, 0).applyQuaternion(handWorld).y).toBeCloseTo(-1, 5);
    expect(new Vector3(1, 0, 0).applyQuaternion(handWorld).z).toBeGreaterThan(0.9);
  });

  it('touch presets become IK targets with a rig (chest hand lands ON the chest, not inside)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { leftArm: { touch: 'chest' } }, REST);
    const wrist = leftWristWorld(bones);
    // The angle preset used to fold the hand past the midline into the chest
    // volume (z ≈ -0.04); the IK target pins it on the front surface.
    expect(wrist.z).toBeGreaterThan(0.08);
    expect(Math.abs(wrist.x)).toBeLessThan(0.12);
    expect(wrist.y).toBeCloseTo(1.20, 1);
  });

  it('pushes a handAt target EXACTLY on the torso centerline out sideways', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { handAt: { x: 0, y: 0.90, z: 0 } }, // zero radial direction
    }, REST);
    const wrist = leftWristWorld(bones);
    const radial = Math.sqrt(wrist.x * wrist.x + wrist.z * wrist.z);
    expect(radial).toBeGreaterThan(0.12);
    expect(wrist.x).toBeGreaterThan(0.1); // toward the LEFT arm's own side
  });

  it('pushes a handAt target out of the torso volume (body is an obstacle)', () => {
    const { bones, resolve, resetPose } = makeRig();
    // Target ON the torso centerline — inside the flesh.
    applyPose(resolve, resetPose, {
      leftArm: { handAt: { x: 0, y: 0.90, z: 0.02 } },
    }, REST);
    const wrist = leftWristWorld(bones);
    const radial = Math.sqrt(wrist.x * wrist.x + wrist.z * wrist.z);
    expect(radial).toBeGreaterThan(0.12);
  });

  it('lays the palm against the torso for a self-touch handAt (covering the crotch)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      rightArm: { handAt: { x: -0.03, y: 0.72, z: 0.10 }, elbowDirection: 'in' },
    }, REST);
    const handWorld = bones.get('hips')!.quaternion.clone()
      .multiply(bones.get('rightUpperArm')!.quaternion)
      .multiply(bones.get('rightLowerArm')!.quaternion)
      .multiply(bones.get('rightHand')!.quaternion);
    // Palm normal points at the torso axis (inward/backward), not forward.
    const palm = new Vector3(0, -1, 0).applyQuaternion(handWorld);
    expect(palm.z).toBeLessThan(-0.5);
  });

  it('an explicit wrist/forearmTwist overrides the palm-on-body auto-orientation', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      rightArm: { handAt: { x: -0.03, y: 0.72, z: 0.10 }, forearmTwist: 0, wrist: 0 },
    }, REST);
    expect(bones.get('rightHand')!.rotation.x).toBeCloseTo(0);
    expect(bones.get('rightHand')!.rotation.z).toBeCloseTo(0);
  });

  it('targets follow body.turn (figure frame, not viewer frame)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      body: { turn: 90, crouch: 0.3 },
      leftLeg: { footAt: { x: 0.09, y: 0, z: 0.25 } },
    }, REST);
    // Figure front (+z_fig) is world -X when facing viewer-left.
    const ankle = leftAnkleWorld(bones, 0.3);
    expect(ankle.x).toBeCloseTo(-0.25, 3);
    expect(ankle.z).toBeCloseTo(0.09, 3);
  });

  it('a target-only arm falls back to relaxed hanging (not T-pose) without a rig', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { handAt: { x: 0.15, y: 0, z: 0.4 } },
    });
    const dir = limbDirection(bones.get('leftUpperArm')!, new Vector3(1, 0, 0));
    expect(dir.y).toBeLessThan(-0.9); // hanging down, not sideways
  });

  it('the target-only fallback keeps explicit override fields (wrist etc.)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { handAt: { x: 0.15, y: 0, z: 0.4 }, elbowBend: 45, wrist: 80 },
    });
    expect(bones.get('leftLowerArm')!.quaternion.w).toBeCloseTo(Math.cos((45 / 2) * DEG), 5);
    expect(bones.get('leftHand')!.rotation.z).toBeCloseTo(80 * DEG);
  });

  it('ignores targets without a rig (angle fields still apply)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftLeg: { forward: 90, footAt: { x: 0.09, y: 0, z: 0.25 } },
    });
    expect(bones.get('leftUpperLeg')!.rotation.x).toBeCloseTo(-90 * DEG);
  });

  it('a rig without targets leaves the angle path untouched', () => {
    const plain = makeRig();
    applyPose(plain.resolve, plain.resetPose, { leftArm: { raise: 60, forward: 70, elbowBend: 40 } });
    const withRig = makeRig();
    applyPose(withRig.resolve, withRig.resetPose, { leftArm: { raise: 60, forward: 70, elbowBend: 40 } }, REST);
    expect(withRig.bones.get('leftUpperArm')!.quaternion.angleTo(
      plain.bones.get('leftUpperArm')!.quaternion,
    )).toBeCloseTo(0, 6);
  });

  it('hipsHeight pins the hips at an absolute floor height (overriding crouch)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { hipsHeight: 0.15, crouch: 1 } }, REST);
    expect(bones.get('hips')!.position.y).toBeCloseTo(0.15 - 0.80, 6);
  });

  it('crouch keeps its fixed drop when hipsHeight is absent (with a rig)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { crouch: 1 } }, REST);
    expect(bones.get('hips')!.position.y).toBeCloseTo(-CROUCH_DROP, 6);
  });

  it('hipsHeight is ignored without a rig (crouch fallback)', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, { body: { hipsHeight: 0.15, crouch: 0.5 } });
    expect(bones.get('hips')!.position.y).toBeCloseTo(-0.5 * CROUCH_DROP, 6);
  });

  it('an out-of-reach target is clamped, not NaN', () => {
    const { bones, resolve, resetPose } = makeRig();
    applyPose(resolve, resetPose, {
      leftArm: { handAt: { x: 1.4, y: 1.3, z: 0.5 } },
    }, REST);
    const q = bones.get('leftUpperArm')!.quaternion;
    expect([q.x, q.y, q.z, q.w].some(Number.isNaN)).toBe(false);
    const wrist = leftWristWorld(bones);
    expect(wrist.distanceTo(new Vector3(0.13, 1.3, 0))).toBeCloseTo(0.53 * 0.999, 3);
  });
});
