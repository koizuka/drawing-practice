import { describe, it, expect, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { applyPose, TOUCH_PRESETS, type BoneResolver, type PoseBoneName } from './poseMapping';

const DEG = Math.PI / 180;

function makeRig() {
  const bones = new Map<PoseBoneName, Object3D>();
  const names: PoseBoneName[] = [
    'hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
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
    ['back', 'left', { y: 90 * DEG, z: 0 }],
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
