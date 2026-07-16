/**
 * Extract the humanoid rest rig (T-pose joint world positions + humanoid
 * parent chain) from a .vrm file into a JSON fixture, so pose mapping /
 * validation can run headlessly (vitest, no browser / WebGL) against the
 * REAL model's proportions.
 *
 * Usage: node scripts/extract-pose-rig.mjs [input.vrm] [output.json]
 * Defaults: public/mannequin.vrm -> src/pose/__fixtures__/mannequinRig.json
 *
 * The output space matches PoseViewer.rigOf's sampling of the three-vrm
 * NORMALIZED humanoid: +Y up, floor y = 0, model faces +Z, model's left = +X.
 * VRM 0.x raw scenes face -Z, so their positions get the same 180° yaw that
 * VRMUtils.rotateVRM0 applies at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'public/mannequin.vrm');
const output = resolve(process.argv[3] ?? 'src/pose/__fixtures__/mannequinRig.json');

const buf = readFileSync(input);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
const jsonLen = buf.readUInt32LE(12);
if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

// --- humanoid bone map: VRM 1.0 (VRMC_vrm) or VRM 0.x (VRM) -----------------
const ext = gltf.extensions ?? {};
let humanBones; // Record<humanoidBoneName, nodeIndex>
let isVrm0 = false;
if (ext.VRMC_vrm?.humanoid?.humanBones) {
  humanBones = Object.fromEntries(
    Object.entries(ext.VRMC_vrm.humanoid.humanBones).map(([name, b]) => [name, b.node]),
  );
}
else if (ext.VRM?.humanoid?.humanBones) {
  isVrm0 = true;
  humanBones = Object.fromEntries(
    ext.VRM.humanoid.humanBones.map(b => [b.bone, b.node]),
  );
}
else {
  throw new Error('no VRM humanoid extension found');
}

// --- rest world positions via TRS composition ------------------------------
const nodes = gltf.nodes ?? [];
const parentOf = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));

/** column-major 4x4 multiply: out = a * b */
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // rotation matrix from quaternion, column-major, with scale then translation
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const worldCache = new Map();
function worldMatrix(i) {
  if (worldCache.has(i)) return worldCache.get(i);
  const local = localMatrix(nodes[i]);
  const p = parentOf.get(i);
  const world = p === undefined ? local : mul(worldMatrix(p), local);
  worldCache.set(i, world);
  return world;
}

function worldPosition(i) {
  const m = worldMatrix(i);
  // VRM0 raw scenes face -Z; rotate 180° about +Y to match the normalized rig.
  return isVrm0 ? [-m[12], m[13], -m[14]] : [m[12], m[13], m[14]];
}

// --- humanoid parent = nearest ancestor that is also a humanoid bone -------
const nodeToBone = new Map(Object.entries(humanBones).map(([name, i]) => [i, name]));
function humanoidParent(nodeIndex) {
  for (let p = parentOf.get(nodeIndex); p !== undefined; p = parentOf.get(p)) {
    const bone = nodeToBone.get(p);
    if (bone) return bone;
  }
  return null;
}

const round = v => Math.round(v * 1e5) / 1e5;
const bones = {};
for (const [name, nodeIndex] of Object.entries(humanBones)) {
  bones[name] = {
    parent: humanoidParent(nodeIndex),
    position: worldPosition(nodeIndex).map(round),
  };
}

const fixture = {
  source: input.replace(/^.*\/public\//, 'public/'),
  vrmVersion: isVrm0 ? '0.x' : '1.0',
  bones,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(fixture, null, 2) + '\n');

const head = bones.head?.position[1];
console.log(`wrote ${output}`);
console.log(`vrm ${fixture.vrmVersion}, ${Object.keys(bones).length} humanoid bones`);
console.log(`head y = ${head} (standing height ~ ${head !== undefined ? (head + 0.12).toFixed(3) : '?'} m)`);
console.log(`hips y = ${bones.hips?.position[1]}, toes z = ${bones.leftToes?.position[2]} (should be > foot z ${bones.leftFoot?.position[2]})`);
