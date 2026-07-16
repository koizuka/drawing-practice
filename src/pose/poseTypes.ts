/**
 * Semantic pose description produced by the LLM from a stick-figure sketch.
 * All angles are in degrees. Conventions (viewer-relative where noted) are
 * documented in posePrompt.ts and implemented in poseMapping.ts — the three
 * files must stay in sync.
 */

export const ELBOW_DIRECTIONS = ['front', 'down', 'up', 'back', 'in', 'out'] as const;
export type ElbowDirection = (typeof ELBOW_DIRECTIONS)[number];

export const TOUCH_TARGETS = ['hip', 'head', 'chest'] as const;
export type TouchTarget = (typeof TOUCH_TARGETS)[number];

export const KNEE_DIRECTIONS = ['front', 'out', 'in'] as const;
export type KneeDirection = (typeof KNEE_DIRECTIONS)[number];

/**
 * Placement target in the FIGURE frame: origin on the floor below the hips,
 * +y up, +x the figure's left, +z its front; meters for a nominal 1.6 m
 * figure (rescaled to the model by poseIk.targetScale). y = 0 means planted
 * on the floor.
 */
export interface TargetPoint {
  x: number;
  y: number;
  z: number;
}

export interface ArmPose {
  /** Upper-arm angle from hanging straight down, in the coronal plane. 0 = at side, 90 = T-pose, 180 = up. */
  raise?: number;
  /** Rotation of the arm direction toward the figure's front. 0 = coronal plane, 90 = straight forward. */
  forward?: number;
  /** 0 = straight .. 150. */
  elbowBend?: number;
  elbowDirection?: ElbowDirection;
  /** Wrist hinge. + = hand bends back (extension — palm pushes away), - = curls inward (flexion). 0 = in line with the forearm. */
  wrist?: number;
  /**
   * Forearm pronation/supination: rolls the hand about the forearm's own
   * axis. + = the palm rolls toward the body's front from its palm-down
   * T-pose rest, - = toward the back; 180 = palm up.
   */
  forearmTwist?: number;
  /** When set, replaces the angle fields with a hand-on-body preset. */
  touch?: TouchTarget;
  /** IK target for the elbow joint. Overrides the pole hint from elbowDirection. */
  elbowAt?: TargetPoint;
  /**
   * IK target for the wrist joint; overrides raise/forward/elbowBend. y = 0
   * plants the palm flat on the floor (wrist/forearmTwist then auto-derived
   * unless given explicitly).
   */
  handAt?: TargetPoint;
}

export interface LegPose {
  /** Hip flexion. 0 = straight down, 90 = thigh horizontal front, negative = extended backward. */
  forward?: number;
  /** Outward abduction. */
  spread?: number;
  /** Hip rotation about the thigh axis. + = external (knee/toes turn outward), - = internal. */
  rotation?: number;
  /** 0 = straight, bends backward, up to 160. */
  kneeBend?: number;
  /**
   * Tibial rotation: twist of the lower leg about its own axis at the knee.
   * + = foot/toes turn outward, - = inward. Only meaningful with a bent knee.
   */
  shinTwist?: number;
  /** Ankle flex relative to the shin. + = toes lift toward the shin (dorsiflexion), - = toes point away. */
  ankle?: number;
  /** IK target for the knee joint. Overrides the pole hint from kneeDirection. */
  kneeAt?: TargetPoint;
  /**
   * IK target for the ankle joint; overrides forward/spread/rotation/kneeBend.
   * y = 0 plants the sole flat on the floor (ankle then auto-derived unless
   * given explicitly).
   */
  footAt?: TargetPoint;
  /** Which way the knee apex points when solving footAt. Default 'front'. */
  kneeDirection?: KneeDirection;
}

export interface BodyPose {
  /**
   * Hip hinge: pitches the pelvis (and with it the whole body) forward about
   * the hip joints, spine staying straight. Legs are measured relative to the
   * pelvis. 180 = fully inverted (handstand).
   */
  bend?: number;
  leanForward?: number;
  /** + = leans toward the figure's left. */
  leanSide?: number;
  /** + = shoulders twist toward the figure's left. */
  twist?: number;
  /** Whole-body facing, viewer-relative: 0 = faces viewer, +90 = faces the viewer's left. */
  turn?: number;
  /** 0 = standing tall .. 1 = hips fully lowered. */
  crouch?: number;
  /**
   * Height of the hip joints above the floor, figure-frame meters (standing
   * ~0.80). Overrides crouch; unlike crouch's fixed drop it can bring the
   * body all the way down for floor sits, all-fours, etc. Only honored when
   * a rig is available (same as the placement targets).
   */
  hipsHeight?: number;
}

export interface HeadPose {
  /** + = looks down. */
  nod?: number;
  /** + = toward the figure's left. */
  turn?: number;
  /** + = tilts toward the figure's left shoulder. */
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
  /**
   * The model's raw reply text, attached by the API caller so the UI can show
   * WHY no pose came back (e.g. a refusal explanation) — parsePoseJson itself
   * only knows the text it was given, the caller owns the display decision.
   */
  replyText?: string;

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

function sanitizeTarget(raw: unknown): TargetPoint | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const t = raw as Record<string, unknown>;
  const x = sanitizeNumber(t.x, -1.5, 1.5);
  const y = sanitizeNumber(t.y, -0.2, 2.2);
  const z = sanitizeNumber(t.z, -1.5, 1.5);
  // All-or-nothing: a partial point is meaningless as an IK target.
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
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
    wrist: sanitizeNumber(a.wrist, -80, 90),
    forearmTwist: sanitizeNumber(a.forearmTwist, -90, 180),
    touch: sanitizeEnum(a.touch, TOUCH_TARGETS),
    elbowAt: sanitizeTarget(a.elbowAt),
    handAt: sanitizeTarget(a.handAt),
  });
}

function sanitizeLeg(raw: unknown): LegPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const l = raw as Record<string, unknown>;
  return pruneUndefined<LegPose>({
    forward: sanitizeNumber(l.forward, -60, 150),
    spread: sanitizeNumber(l.spread, 0, 80),
    // Symmetric: external rotation up to 90 (agura) AND internal down to -90
    // (girl-style / W-sitting needs -45..-60 — an asymmetric floor here
    // silently broke those poses even when the model emitted them right).
    rotation: sanitizeNumber(l.rotation, -90, 90),
    kneeBend: sanitizeNumber(l.kneeBend, 0, 160),
    shinTwist: sanitizeNumber(l.shinTwist, -60, 60),
    ankle: sanitizeNumber(l.ankle, -60, 45),
    kneeAt: sanitizeTarget(l.kneeAt),
    footAt: sanitizeTarget(l.footAt),
    kneeDirection: sanitizeEnum(l.kneeDirection, KNEE_DIRECTIONS),
  });
}

function sanitizeBody(raw: unknown): BodyPose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const b = raw as Record<string, unknown>;
  return pruneUndefined<BodyPose>({
    bend: sanitizeNumber(b.bend, -180, 180),
    leanForward: sanitizeNumber(b.leanForward, -45, 90),
    leanSide: sanitizeNumber(b.leanSide, -60, 60),
    twist: sanitizeNumber(b.twist, -90, 90),
    turn: sanitizeNumber(b.turn, -180, 180),
    crouch: sanitizeNumber(b.crouch, 0, 1),
    hipsHeight: sanitizeNumber(b.hipsHeight, 0.03, 1.5),
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
  // The prompt asks for a short prose analysis followed by the JSON object
  // as the LAST thing in the reply — and the prose may itself contain stray
  // braces or even small valid JSON snippets (schema echoes, examples).
  // Scan candidates from the END: for each closing brace (last first), try
  // opening braces from the nearest one outward, so the first slice that
  // parses is the last complete top-level JSON object in the text — never an
  // earlier prose fragment.
  if (raw.indexOf('{') === -1 || raw.indexOf('}') === -1) {
    throw new PoseParseError('no JSON object in response');
  }
  let parsed: unknown;
  let found = false;
  for (let end = raw.lastIndexOf('}'); end !== -1 && !found; end = raw.lastIndexOf('}', end - 1)) {
    for (let start = raw.lastIndexOf('{', end); start !== -1; start = raw.lastIndexOf('{', start - 1)) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
        found = true;
        break;
      }
      catch { /* keep scanning */ }
    }
  }
  if (!found) {
    throw new PoseParseError('invalid JSON in response');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
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
