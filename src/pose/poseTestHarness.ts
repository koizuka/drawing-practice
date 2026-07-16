/**
 * Headless pose harness: rebuilds the bundled mannequin's normalized-humanoid
 * skeleton from the extracted fixture (scripts/extract-pose-rig.mjs →
 * __fixtures__/mannequinRig.json), so applyPose → landmark measurement →
 * diagnosePose runs in vitest with the REAL model's proportions — no
 * browser, no WebGL. Mirrors PoseViewer's rigOf / measurePose semantics:
 * three-vrm normalized space (+Y up, floor y = 0, faces +Z, left = +X),
 * humanoid proxy bones with identity rest rotations, so world rest position
 * offsets ARE the local rest translations.
 *
 * Test-only — import from *.test.ts (and the manual LLM-loop runner), never
 * from app code.
 */
import { Object3D, Vector3 } from 'three';
import { applyPose, type BoneResolver, type PoseBoneName } from './poseMapping';
import { RIG_JOINT_NAMES, type PoseRig } from './poseIk';
import {
  LANDMARK_NAMES,
  diagnosePose,
  type LandmarkSet,
  type PoseMeasurement,
} from './poseValidation';
import type { PoseJson } from './poseTypes';
import fixture from './__fixtures__/mannequinRig.json';

interface FixtureBone {
  parent: string | null;
  position: number[];
}

const FIXTURE_BONES = fixture.bones as Record<string, FixtureBone>;

export interface PoseHarness {
  resolve: BoneResolver;
  resetPose: () => void;
  /** Rest joint positions, same shape PoseViewer.rigOf samples. */
  rig: PoseRig;
  /** Apply a pose and sample rest + posed landmarks (PoseViewer.measurePose). */
  applyAndMeasure: (pose: PoseJson) => PoseMeasurement;
  /** applyAndMeasure + diagnosePose — [] means the pose passes validation. */
  diagnose: (pose: PoseJson) => string[];
}

export function makeMannequinHarness(): PoseHarness {
  const root = new Object3D();
  const bones = new Map<string, Object3D>();
  for (const name of Object.keys(FIXTURE_BONES)) {
    const bone = new Object3D();
    bone.name = name;
    bones.set(name, bone);
  }
  const localOffset = (name: string): [number, number, number] => {
    const { parent, position } = FIXTURE_BONES[name];
    const pp = parent ? FIXTURE_BONES[parent].position : [0, 0, 0];
    return [position[0] - pp[0], position[1] - pp[1], position[2] - pp[2]];
  };
  for (const [name, { parent }] of Object.entries(FIXTURE_BONES)) {
    (parent ? bones.get(parent)! : root).add(bones.get(name)!);
    bones.get(name)!.position.set(...localOffset(name));
  }

  const resolve: BoneResolver = name => bones.get(name) ?? null;
  const resetPose = () => {
    for (const [name, bone] of bones) {
      bone.rotation.set(0, 0, 0);
      bone.position.set(...localOffset(name));
    }
  };

  const rig: PoseRig = {};
  for (const name of RIG_JOINT_NAMES) {
    const b = FIXTURE_BONES[name];
    if (b) rig[name] = { x: b.position[0], y: b.position[1], z: b.position[2] };
  }

  const rest: LandmarkSet = {};
  for (const name of LANDMARK_NAMES) {
    const b = FIXTURE_BONES[name];
    if (b) rest[name] = { x: b.position[0], y: b.position[1], z: b.position[2] };
  }

  const applyAndMeasure = (pose: PoseJson): PoseMeasurement => {
    applyPose(resolve, resetPose, pose, rig);
    root.updateWorldMatrix(true, true);
    const posed: LandmarkSet = {};
    const v = new Vector3();
    for (const name of LANDMARK_NAMES) {
      const bone = bones.get(name);
      if (!bone) continue;
      bone.getWorldPosition(v);
      posed[name] = { x: v.x, y: v.y, z: v.z };
    }
    return { rest, posed };
  };

  const diagnose = (pose: PoseJson): string[] => diagnosePose(applyAndMeasure(pose), pose);

  return { resolve, resetPose, rig, applyAndMeasure, diagnose };
}

/** Names of bones applyPose actually drives — exported for harness tests. */
export const HARNESS_BONE_NAMES: readonly PoseBoneName[] = [
  'hips', 'spine', 'chest', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];
