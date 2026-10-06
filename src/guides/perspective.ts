import type { PerspectiveSettings, PerspectiveShape } from './types';

/**
 * Perspective grid shapes projected onto world-2D coordinates:
 * - 'room': a room-like open box (floor + 4 gridded walls, no ceiling) — a
 *   stage to put the subject in. Walls facing away are culled.
 * - 'box': a cube with center lines on every face — a construction form the
 *   subject itself is built on.
 * - 'head': a Loomis-style head (cranium sphere with the sides sliced off,
 *   brow / center lines, face plane and jaw).
 * Construction forms are "drawn through": back-facing lines are kept but
 * flagged `hidden` (rendered faint). All functions are pure and
 * canvas-independent: parameters in, world-space line segments out. The
 * existing per-panel projection pipeline (shared camera, per-panel baseScale)
 * then renders the segments like any other guide geometry.
 */

export interface PerspectiveSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Outer face edge (drawn thicker), as opposed to an interior grid line. */
  major: boolean;
  /** On the far side of a construction form (drawn faint). Always false for 'room'. */
  hidden: boolean;
}

/** Floor cell size in world units (matches the 'normal' grid spacing). */
export const PERSPECTIVE_CELL = 100;
/** Floor cells per side. */
export const PERSPECTIVE_FLOOR_CELLS = 8;
/** Wall height in world units. */
export const PERSPECTIVE_WALL_HEIGHT = 300;

const HALF = (PERSPECTIVE_FLOOR_CELLS * PERSPECTIVE_CELL) / 2; // 400
const FLOOR_Y = PERSPECTIVE_WALL_HEIGHT / 2; // pivot = floor center raised by half the wall height
const TOP_Y = FLOOR_Y - PERSPECTIVE_WALL_HEIGHT;

// Dolly-zoom formulation: strength picks the camera's half field-of-view and
// the camera distance is derived so the pivot plane keeps unit magnification.
// The box therefore stays roughly the same apparent size while only the
// distortion changes; strength → 0 converges to parallel projection.
const MIN_HALF_ANGLE = (1 * Math.PI) / 180;
const MAX_HALF_ANGLE = (32 * Math.PI) / 180;
/** Fraction of the camera distance kept as the near clipping plane. */
const NEAR_FRACTION = 0.05;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Segment3D {
  a: Vec3;
  b: Vec3;
  major: boolean;
  /**
   * Outward normals of the surfaces the segment lies on; visible when ANY of
   * them faces the camera (an edge is visible if either adjacent face is).
   * Absent = always visible.
   */
  normals?: Vec3[];
}

type WallId = 'back' | 'front' | 'left' | 'right';

interface Wall {
  id: WallId;
  outwardNormal: Vec3;
  center: Vec3;
  segments: Segment3D[];
}

function seg(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  major: boolean,
): Segment3D {
  return { a: { x: ax, y: ay, z: az }, b: { x: bx, y: by, z: bz }, major };
}

/** Grid line offsets across one face side, e.g. -400, -300, ..., +400. */
function offsets(): number[] {
  const result: number[] = [];
  for (let i = 0; i <= PERSPECTIVE_FLOOR_CELLS; i++) {
    result.push(-HALF + i * PERSPECTIVE_CELL);
  }
  return result;
}

function floorSegments(): Segment3D[] {
  const lines: Segment3D[] = [];
  for (const o of offsets()) {
    const major = Math.abs(o) === HALF;
    lines.push(seg(o, FLOOR_Y, -HALF, o, FLOOR_Y, HALF, major)); // parallel to z
    lines.push(seg(-HALF, FLOOR_Y, o, HALF, FLOOR_Y, o, major)); // parallel to x
  }
  return lines;
}

/**
 * Build one wall's grid. `place` maps (u = position along the wall,
 * y = height) into 3D on that wall's plane.
 */
function wallSegments(place: (u: number, y: number) => Vec3): Segment3D[] {
  const lines: Segment3D[] = [];
  for (const u of offsets()) {
    const major = Math.abs(u) === HALF;
    const a = place(u, TOP_Y);
    const b = place(u, FLOOR_Y);
    lines.push({ a, b, major });
  }
  for (let y = TOP_Y; y <= FLOOR_Y; y += PERSPECTIVE_CELL) {
    const major = y === TOP_Y || y === FLOOR_Y;
    const a = place(-HALF, y);
    const b = place(HALF, y);
    lines.push({ a, b, major });
  }
  return lines;
}

function buildWalls(): Wall[] {
  return [
    {
      id: 'back',
      outwardNormal: { x: 0, y: 0, z: 1 },
      center: { x: 0, y: 0, z: HALF },
      segments: wallSegments((u, y) => ({ x: u, y, z: HALF })),
    },
    {
      id: 'front',
      outwardNormal: { x: 0, y: 0, z: -1 },
      center: { x: 0, y: 0, z: -HALF },
      segments: wallSegments((u, y) => ({ x: u, y, z: -HALF })),
    },
    {
      id: 'left',
      outwardNormal: { x: -1, y: 0, z: 0 },
      center: { x: -HALF, y: 0, z: 0 },
      segments: wallSegments((u, y) => ({ x: -HALF, y, z: u })),
    },
    {
      id: 'right',
      outwardNormal: { x: 1, y: 0, z: 0 },
      center: { x: HALF, y: 0, z: 0 },
      segments: wallSegments((u, y) => ({ x: HALF, y, z: u })),
    },
  ];
}

// --- Box (cube) -------------------------------------------------------------

/** Half the cube side in world units at size 1. */
export const PERSPECTIVE_BOX_HALF = 120;

function axisVec(axis: number, value: number): Vec3 {
  return { x: axis === 0 ? value : 0, y: axis === 1 ? value : 0, z: axis === 2 ? value : 0 };
}

function addVec(...vs: Vec3[]): Vec3 {
  return vs.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
}

function boxSegments(): Segment3D[] {
  const h = PERSPECTIVE_BOX_HALF;
  const lines: Segment3D[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    for (const si of [-1, 1]) {
      for (const sj of [-1, 1]) {
        // 12 edges, each bounded by the two faces normal to the other axes.
        const base = addVec(axisVec(i, si * h), axisVec(j, sj * h));
        lines.push({
          a: addVec(base, axisVec(axis, -h)),
          b: addVec(base, axisVec(axis, h)),
          major: true,
          normals: [axisVec(i, si), axisVec(j, sj)],
        });
      }
    }
    // Center cross on the two faces normal to `axis`: the lines that carry
    // symmetry (face center line, eye line, ...) into perspective.
    for (const s of [-1, 1]) {
      const face = axisVec(axis, s * h);
      for (const along of [i, j]) {
        lines.push({
          a: addVec(face, axisVec(along, -h)),
          b: addVec(face, axisVec(along, h)),
          major: false,
          normals: [axisVec(axis, s)],
        });
      }
    }
  }
  return lines;
}

// --- Head (Loomis) -----------------------------------------------------------

/** Cranium sphere radius in world units at size 1. */
export const PERSPECTIVE_HEAD_RADIUS = 160;

// Proportions in sphere-radius units, after Loomis as taught by Proko: the
// side-plane circle is 2/3 of the ball's height, and its radius is one face
// third — hairline (y = -THIRD) / brow (0) / nose base (+THIRD) / chin
// (+2 THIRD). Crown to hairline is then half a third, i.e. the head is 3.5
// thirds tall (≈ 1.17 × the ball's diameter, matching adult head
// height / length). The side planes sit at |x| = HEAD_SIDE. Front of the face
// looks toward the camera (-z) at yaw 0.
const HEAD_THIRD = 2 / 3;
const HEAD_SIDE = Math.sqrt(1 - HEAD_THIRD * HEAD_THIRD); // ≈ 0.745
const HEAD_CHIN: Vec3 = { x: 0, y: 2 * HEAD_THIRD, z: -0.8 };
const CIRCLE_STEPS = 48;

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * Polyline approximation of a parametric curve, one Segment3D per step.
 * `normal` gives the surface normal at a point (sphere: the point itself).
 * `keep` can drop steps (e.g. the parts of the brow line sliced off).
 */
function curve(
  point: (t: number) => Vec3,
  t0: number,
  t1: number,
  steps: number,
  major: boolean,
  normal: (p: Vec3) => Vec3,
  keep: (mid: Vec3) => boolean = () => true,
): Segment3D[] {
  const lines: Segment3D[] = [];
  for (let k = 0; k < steps; k++) {
    const a = point(t0 + ((t1 - t0) * k) / steps);
    const b = point(t0 + ((t1 - t0) * (k + 1)) / steps);
    const mid = v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    if (!keep(mid)) continue;
    lines.push({ a, b, major, normals: [normal(mid)] });
  }
  return lines;
}

function polyline(points: Vec3[], major: boolean, normal: Vec3): Segment3D[] {
  const lines: Segment3D[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    lines.push({ a: points[k], b: points[k + 1], major, normals: [normal] });
  }
  return lines;
}

function scaleSegments(lines: Segment3D[], k: number): Segment3D[] {
  const sc = (v: Vec3) => v3(v.x * k, v.y * k, v.z * k);
  return lines.map((l) => ({ ...l, a: sc(l.a), b: sc(l.b) }));
}

function headSegments(): Segment3D[] {
  const TAU = Math.PI * 2;
  const onSphere = (p: Vec3) => p;
  const lines: Segment3D[] = [];

  // Brow line (equator), minus the parts sliced away by the side planes.
  lines.push(
    ...curve(
      (t) => v3(Math.cos(t), 0, Math.sin(t)),
      0,
      TAU,
      CIRCLE_STEPS,
      false,
      onSphere,
      (mid) => Math.abs(mid.x) <= HEAD_SIDE,
    ),
  );
  // Center line (the vertical great circle through the face).
  lines.push(
    ...curve((t) => v3(0, Math.cos(t), Math.sin(t)), 0, TAU, CIRCLE_STEPS, false, onSphere),
  );
  // Hairline: front half of the latitude where the side circles top out.
  lines.push(
    ...curve(
      (t) => v3(HEAD_SIDE * Math.cos(t), -HEAD_THIRD, HEAD_SIDE * Math.sin(t)),
      Math.PI,
      TAU,
      CIRCLE_STEPS / 2,
      false,
      onSphere,
    ),
  );

  for (const s of [-1, 1]) {
    const side = v3(s, 0, 0);
    const cx = s * HEAD_SIDE;
    // Side-plane circle with its cross (the ear sits near its lower back).
    lines.push(
      ...curve(
        (t) => v3(cx, HEAD_THIRD * Math.cos(t), HEAD_THIRD * Math.sin(t)),
        0,
        TAU,
        CIRCLE_STEPS,
        true,
        () => side,
      ),
    );
    lines.push({
      a: v3(cx, -HEAD_THIRD, 0),
      b: v3(cx, HEAD_THIRD, 0),
      major: false,
      normals: [side],
    });
    lines.push({
      a: v3(cx, 0, -HEAD_THIRD),
      b: v3(cx, 0, HEAD_THIRD),
      major: false,
      normals: [side],
    });

    // Nose line: from the bottom of the side circle around to the face front.
    const sideBottom = v3(cx, HEAD_THIRD, 0);
    const noseCorner = v3(s * 0.35, HEAD_THIRD, -0.8);
    const noseCenter = v3(0, HEAD_THIRD, -0.9);
    lines.push(...polyline([sideBottom, noseCorner], false, v3(s, 0, -1)));
    lines.push(...polyline([noseCorner, noseCenter], false, v3(0, 0, -1)));

    // Jaw: down from below the ear to the jaw angle, then forward to the chin.
    const jawAngle = v3(s * 0.87 * HEAD_SIDE, 1.6 * HEAD_THIRD, -0.05);
    const chinCorner = v3(s * 0.22, HEAD_CHIN.y - 0.03, HEAD_CHIN.z + 0.06);
    // The ramus flares slightly forward, so it still reads as outline head-on.
    lines.push(...polyline([sideBottom, jawAngle], true, v3(s, 0, -0.5)));
    lines.push(...polyline([jawAngle, chinCorner], true, v3(s, 0.4, -0.7)));
    lines.push(...polyline([chinCorner, HEAD_CHIN], true, v3(0, 0.3, -1)));
  }

  // Face center line down the face plane, brow to chin.
  lines.push(...polyline([v3(0, 0, -1), HEAD_CHIN], false, v3(0, 0, -1)));

  return scaleSegments(lines, PERSPECTIVE_HEAD_RADIUS);
}

// Static geometry, built once.
const FLOOR = floorSegments();
const WALLS = buildWalls();
const BOX = boxSegments();
const HEAD = headSegments();

/**
 * Radius the dolly-zoom camera distance is derived from, per shape. For the
 * construction forms it is the bounding radius around the pivot, so even the
 * widest angle keeps the camera outside the form (no near-plane clipping).
 */
const REF_RADIUS: Record<PerspectiveShape, number> = {
  room: HALF,
  box: PERSPECTIVE_BOX_HALF * Math.sqrt(3),
  head: PERSPECTIVE_HEAD_RADIUS * Math.hypot(HEAD_CHIN.y, HEAD_CHIN.z),
};

function rotate(v: Vec3, sinYaw: number, cosYaw: number, sinPitch: number, cosPitch: number): Vec3 {
  // Yaw about the y axis, then pitch about the x axis.
  const x1 = v.x * cosYaw + v.z * sinYaw;
  const z1 = -v.x * sinYaw + v.z * cosYaw;
  const y2 = v.y * cosPitch - z1 * sinPitch;
  const z2 = v.y * sinPitch + z1 * cosPitch;
  return { x: x1, y: y2, z: z2 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Camera + output transform for one settings value. Camera sits at z = -d. */
interface View {
  rotate: (v: Vec3) => Vec3;
  d: number;
  size: number;
  centerX: number;
  centerY: number;
}

function makeView(settings: PerspectiveSettings, refRadius: number): View {
  const yawRad = (settings.yaw * Math.PI) / 180;
  const pitchRad = (settings.pitch * Math.PI) / 180;
  const sinYaw = Math.sin(yawRad);
  const cosYaw = Math.cos(yawRad);
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);
  const halfAngle = lerp(MIN_HALF_ANGLE, MAX_HALF_ANGLE, settings.strength);
  return {
    rotate: (v) => rotate(v, sinYaw, cosYaw, sinPitch, cosPitch),
    d: refRadius / Math.tan(halfAngle),
    size: settings.size,
    centerX: settings.centerX,
    centerY: settings.centerY,
  };
}

/** Whether a surface with (rotated) outward normal `n` at (rotated) point `p` faces the camera. */
function facesCamera(n: Vec3, p: Vec3, d: number): boolean {
  return n.x * p.x + n.y * p.y + n.z * (p.z + d) < 0;
}

/** Project an already-rotated segment, clipping it against the near plane. */
function project(
  out: PerspectiveSegment[],
  view: View,
  a: Vec3,
  b: Vec3,
  major: boolean,
  hidden: boolean,
): void {
  const { d } = view;
  // Near-plane clip in camera space (camera at z = -d): keep d + z > near.
  const near = d * NEAR_FRACTION;
  const za = d + a.z;
  const zb = d + b.z;
  if (za <= near && zb <= near) return;
  if (za <= near || zb <= near) {
    const t = (near - za) / (zb - za);
    const cut: Vec3 = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    if (za <= near) a = cut;
    else b = cut;
  }

  const ka = (d / (d + a.z)) * view.size;
  const kb = (d / (d + b.z)) * view.size;
  out.push({
    x1: a.x * ka + view.centerX,
    y1: a.y * ka + view.centerY,
    x2: b.x * kb + view.centerX,
    y2: b.y * kb + view.centerY,
    major,
    hidden,
  });
}

function projectRoom(out: PerspectiveSegment[], view: View): void {
  for (const segment of FLOOR) {
    project(out, view, view.rotate(segment.a), view.rotate(segment.b), segment.major, false);
  }

  // Room-style culling: draw only the walls whose inner face is toward the
  // camera, so near walls never curtain off the interior.
  for (const wall of WALLS) {
    const n = view.rotate(wall.outwardNormal);
    const c = view.rotate(wall.center);
    if (facesCamera(n, c, view.d)) continue;
    for (const segment of wall.segments) {
      project(out, view, view.rotate(segment.a), view.rotate(segment.b), segment.major, false);
    }
  }
}

/** Construction forms: every line is drawn, back-facing ones flagged hidden. */
function projectForm(out: PerspectiveSegment[], view: View, segments: Segment3D[]): void {
  for (const segment of segments) {
    const a = view.rotate(segment.a);
    const b = view.rotate(segment.b);
    const mid: Vec3 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const hidden =
      segment.normals !== undefined &&
      !segment.normals.some((n) => facesCamera(view.rotate(n), mid, view.d));
    project(out, view, a, b, segment.major, hidden);
  }
}

/**
 * Outline of a sphere of `radius` centered on the pivot. The pivot lies on
 * the optical axis, so its perspective silhouette is an exact circle whose
 * radius follows from the tangent cone: d·r / √(d² − r²).
 */
function projectSphereSilhouette(out: PerspectiveSegment[], view: View, radius: number): void {
  const { d } = view;
  const r = ((d * radius) / Math.sqrt(d * d - radius * radius)) * view.size;
  for (let k = 0; k < CIRCLE_STEPS; k++) {
    const t0 = (k / CIRCLE_STEPS) * Math.PI * 2;
    const t1 = ((k + 1) / CIRCLE_STEPS) * Math.PI * 2;
    out.push({
      x1: view.centerX + r * Math.cos(t0),
      y1: view.centerY + r * Math.sin(t0),
      x2: view.centerX + r * Math.cos(t1),
      y2: view.centerY + r * Math.sin(t1),
      major: true,
      hidden: false,
    });
  }
}

interface CacheEntry {
  settings: PerspectiveSettings;
  shape: PerspectiveShape;
  lines: PerspectiveSegment[];
}

let cache: CacheEntry | null = null;

function sameSettings(a: PerspectiveSettings, b: PerspectiveSettings): boolean {
  return (
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    a.strength === b.strength &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.size === b.size
  );
}

/**
 * Compute the perspective grid as world-2D segments. Results are cached for
 * the last settings value so the two panels sharing one state compute once.
 */
export function computePerspectiveGridLines(
  settings: PerspectiveSettings,
  shape: PerspectiveShape = 'room',
): PerspectiveSegment[] {
  if (cache && cache.shape === shape && sameSettings(cache.settings, settings)) return cache.lines;

  const view = makeView(settings, REF_RADIUS[shape]);
  const lines: PerspectiveSegment[] = [];
  switch (shape) {
    case 'room':
      projectRoom(lines, view);
      break;
    case 'box':
      projectForm(lines, view, BOX);
      break;
    case 'head':
      projectSphereSilhouette(lines, view, PERSPECTIVE_HEAD_RADIUS);
      projectForm(lines, view, HEAD);
      break;
  }

  cache = { settings: { ...settings }, shape, lines };
  return lines;
}
