/**
 * Semantic pose description produced by the LLM from a stick-figure sketch.
 * All angles are in degrees. Conventions (viewer-relative where noted) are
 * documented in posePrompt.ts and implemented in poseMapping.ts — the three
 * files must stay in sync.
 */

export const ELBOW_DIRECTIONS = ['front', 'down', 'up', 'back'] as const;
export type ElbowDirection = (typeof ELBOW_DIRECTIONS)[number];

export const TOUCH_TARGETS = ['hip', 'head', 'chest'] as const;
export type TouchTarget = (typeof TOUCH_TARGETS)[number];

export interface ArmPose {
  /** Upper-arm angle from hanging straight down, in the coronal plane. 0 = at side, 90 = T-pose, 180 = up. */
  raise?: number;
  /** Rotation of the arm direction toward the figure's front. 0 = coronal plane, 90 = straight forward. */
  forward?: number;
  /** 0 = straight .. 150. */
  elbowBend?: number;
  elbowDirection?: ElbowDirection;
  /** When set, replaces the angle fields with a hand-on-body preset. */
  touch?: TouchTarget;
}

export interface LegPose {
  /** Hip flexion. 0 = straight down, 90 = thigh horizontal front, negative = extended backward. */
  forward?: number;
  /** Outward abduction. */
  spread?: number;
  /** 0 = straight, bends backward, up to 150. */
  kneeBend?: number;
}

export interface BodyPose {
  leanForward?: number;
  /** + = leans toward the figure's left. */
  leanSide?: number;
  /** + = shoulders twist toward the figure's left. */
  twist?: number;
  /** Whole-body facing, viewer-relative: 0 = faces viewer, +90 = faces the viewer's left. */
  turn?: number;
  /** 0 = standing tall .. 1 = hips fully lowered. */
  crouch?: number;
}

export interface HeadPose {
  /** + = looks down. */
  nod?: number;
  /** + = toward the figure's left. */
  turn?: number;
  tilt?: number;
}

export interface PoseJson {
  body?: BodyPose;
  head?: HeadPose;
  leftArm?: ArmPose;
  rightArm?: ArmPose;
  leftLeg?: LegPose;
  rightLeg?: LegPose;
}

export class PoseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoseParseError';
  }
}

function sanitizeNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function pruneUndefined<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function sanitizeArm(raw: unknown): ArmPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const a = raw as Record<string, unknown>;
  return pruneUndefined<ArmPose>({
    raise: sanitizeNumber(a.raise, 0, 180),
    forward: sanitizeNumber(a.forward, -90, 135),
    elbowBend: sanitizeNumber(a.elbowBend, 0, 150),
    elbowDirection: sanitizeEnum(a.elbowDirection, ELBOW_DIRECTIONS),
    touch: sanitizeEnum(a.touch, TOUCH_TARGETS),
  });
}

function sanitizeLeg(raw: unknown): LegPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const l = raw as Record<string, unknown>;
  return pruneUndefined<LegPose>({
    forward: sanitizeNumber(l.forward, -60, 130),
    spread: sanitizeNumber(l.spread, 0, 80),
    kneeBend: sanitizeNumber(l.kneeBend, 0, 150),
  });
}

function sanitizeBody(raw: unknown): BodyPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const b = raw as Record<string, unknown>;
  return pruneUndefined<BodyPose>({
    leanForward: sanitizeNumber(b.leanForward, -45, 90),
    leanSide: sanitizeNumber(b.leanSide, -60, 60),
    twist: sanitizeNumber(b.twist, -90, 90),
    turn: sanitizeNumber(b.turn, -180, 180),
    crouch: sanitizeNumber(b.crouch, 0, 1),
  });
}

function sanitizeHead(raw: unknown): HeadPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const h = raw as Record<string, unknown>;
  return pruneUndefined<HeadPose>({
    nod: sanitizeNumber(h.nod, -60, 60),
    turn: sanitizeNumber(h.turn, -90, 90),
    tilt: sanitizeNumber(h.tilt, -60, 60),
  });
}

/**
 * Parse an LLM text response into a sanitized PoseJson: strips markdown code
 * fences, extracts the outermost JSON object, clamps numbers to plausible
 * ranges, and drops unknown keys / invalid values.
 *
 * @throws PoseParseError when no parsable JSON object is found.
 */
export function parsePoseJson(raw: string): PoseJson {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new PoseParseError('no JSON object in response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  }
  catch {
    throw new PoseParseError('invalid JSON in response');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PoseParseError('response is not a JSON object');
  }
  const p = parsed as Record<string, unknown>;
  const pose: PoseJson = {};
  const body = sanitizeBody(p.body);
  const head = sanitizeHead(p.head);
  const leftArm = sanitizeArm(p.leftArm);
  const rightArm = sanitizeArm(p.rightArm);
  const leftLeg = sanitizeLeg(p.leftLeg);
  const rightLeg = sanitizeLeg(p.rightLeg);
  if (body) pose.body = body;
  if (head) pose.head = head;
  if (leftArm) pose.leftArm = leftArm;
  if (rightArm) pose.rightArm = rightArm;
  if (leftLeg) pose.leftLeg = leftLeg;
  if (rightLeg) pose.rightLeg = rightLeg;
  return pose;
}
