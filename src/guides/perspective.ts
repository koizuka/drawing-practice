import type { PerspectiveSettings } from './types';

/**
 * Perspective grid box: a room-like open box (floor + 4 gridded walls, no
 * ceiling) projected onto world-2D coordinates. All functions are pure and
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

// Static geometry, built once.
const FLOOR = floorSegments();
const WALLS = buildWalls();

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

function project(
  out: PerspectiveSegment[],
  segment: Segment3D,
  sinYaw: number,
  cosYaw: number,
  sinPitch: number,
  cosPitch: number,
  d: number,
  centerX: number,
  centerY: number,
): void {
  let a = rotate(segment.a, sinYaw, cosYaw, sinPitch, cosPitch);
  let b = rotate(segment.b, sinYaw, cosYaw, sinPitch, cosPitch);

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

  const ka = d / (d + a.z);
  const kb = d / (d + b.z);
  out.push({
    x1: a.x * ka + centerX,
    y1: a.y * ka + centerY,
    x2: b.x * kb + centerX,
    y2: b.y * kb + centerY,
    major: segment.major,
  });
}

interface CacheEntry {
  settings: PerspectiveSettings;
  lines: PerspectiveSegment[];
}

let cache: CacheEntry | null = null;

function sameSettings(a: PerspectiveSettings, b: PerspectiveSettings): boolean {
  return (
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    a.strength === b.strength &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY
  );
}

/**
 * Compute the perspective grid as world-2D segments. Results are cached for
 * the last settings value so the two panels sharing one state compute once.
 */
export function computePerspectiveGridLines(settings: PerspectiveSettings): PerspectiveSegment[] {
  if (cache && sameSettings(cache.settings, settings)) return cache.lines;

  const yawRad = (settings.yaw * Math.PI) / 180;
  const pitchRad = (settings.pitch * Math.PI) / 180;
  const sinYaw = Math.sin(yawRad);
  const cosYaw = Math.cos(yawRad);
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);

  const halfAngle = lerp(MIN_HALF_ANGLE, MAX_HALF_ANGLE, settings.strength);
  const d = HALF / Math.tan(halfAngle);

  const lines: PerspectiveSegment[] = [];

  for (const segment of FLOOR) {
    project(
      lines,
      segment,
      sinYaw,
      cosYaw,
      sinPitch,
      cosPitch,
      d,
      settings.centerX,
      settings.centerY,
    );
  }

  // Room-style culling: draw only the walls whose inner face is toward the
  // camera, so near walls never curtain off the interior.
  const camera: Vec3 = { x: 0, y: 0, z: -d };
  for (const wall of WALLS) {
    const n = rotate(wall.outwardNormal, sinYaw, cosYaw, sinPitch, cosPitch);
    const c = rotate(wall.center, sinYaw, cosYaw, sinPitch, cosPitch);
    const view: Vec3 = { x: c.x - camera.x, y: c.y - camera.y, z: c.z - camera.z };
    const facingAway = n.x * view.x + n.y * view.y + n.z * view.z > 0;
    if (!facingAway) continue;
    for (const segment of wall.segments) {
      project(
        lines,
        segment,
        sinYaw,
        cosYaw,
        sinPitch,
        cosPitch,
        d,
        settings.centerX,
        settings.centerY,
      );
    }
  }

  cache = { settings: { ...settings }, lines };
  return lines;
}
