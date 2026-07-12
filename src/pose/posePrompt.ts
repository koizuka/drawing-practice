/**
 * Prompts for turning a pose sketch (+ optional user hint) — or a hint text
 * alone — into a PoseJson. Verified against the Phase-0 spike
 * (spike/pose-llm/) — the schema, conventions, and left/right rules here must
 * stay in sync with poseTypes.ts and poseMapping.ts.
 */

/** Schema + joint conventions shared by the sketch and text-only prompts. */
const SCHEMA_AND_CONVENTIONS = `{
  "body": {
    "leanForward": number,   // + = torso leans forward, - = backward (range -45..90)
    "leanSide": number,      // + = leans toward figure's left
    "twist": number,         // + = shoulders twist toward figure's left
    "turn": number,          // whole-body facing, VIEWER-relative: 0 = faces the viewer; +90 = faces the viewer's LEFT (you then see the figure's RIGHT profile); -90 = faces the viewer's RIGHT (you see its LEFT profile)
    "crouch": number         // 0 = standing tall .. 1 = hips fully lowered. Deep squat = crouch 0.7-1.0 AND kneeBend 120-150 AND leg forward 90+
  },
  "head": { "nod": number /* + looks down */, "turn": number /* + toward figure's left */, "tilt": number /* + = head tilts toward the figure's left shoulder */ },
  "leftArm":  { "raise": number, "forward": number, "elbowBend": number, "elbowDirection": "front"|"down"|"up"|"back" }
              OR { "touch": "hip"|"head"|"chest" }  // use touch when the hand is placed on that body part (e.g. hand on hip); it replaces the angle fields
  "rightArm": ... same ...,
  "leftLeg":  { "forward": number, "spread": number, "rotation": number, "kneeBend": number },
  "rightLeg": ... same ...
}

Arm conventions: "raise" = upper-arm angle from hanging straight down, measured in the body's coronal plane: 0 = at side, 90 = horizontal T, 180 = straight up. "forward" = rotation of that direction toward the figure's front: 0 = coronal plane, 90 = straight forward. "elbowBend": 0 = straight .. 150. "elbowDirection" = which way the forearm folds.

Leg conventions: "forward" = hip flexion: 0 = straight down, 90 = thigh horizontal front, negative = extended backward. "spread" = outward abduction. "rotation" = hip rotation about the thigh axis: + = external (knee and toes turn outward), - = internal; with the hip flexed and the knee bent, external rotation folds the shin across the body's front. "kneeBend": 0 = straight, bends backward, up to 150. Cross-legged sitting (agura / lotus) = crouch 1, and per leg: forward 90-110, spread 20-40, rotation 60-90, kneeBend 130-150. The two shins stack, not intersect: keep the legs symmetric in spread/rotation/kneeBend and differ ONLY in forward, by about 10-15 degrees (e.g. one leg 90, the other 103), so one folded shin rests on top of the other.

NATURAL POSE BIAS — apply whenever the input leaves room for interpretation:
- Prefer relaxed, anatomically plausible joint configurations. Choose the reading a real human body would naturally take, not a literal geometric one.
- elbowDirection: 'front' folds the forearm toward the body's front — the natural default for most poses; use it when unsure. 'up' = upward curl (waving, flexing). 'down' = forearm hangs down from a raised upper arm. 'back' ONLY when the hand is clearly behind the body (e.g. arm swung back while running).
- Straight arms: elbowBend 0-15, no elbowDirection needed.
- Elbows and knees never bend beyond their natural range; knees only bend backward.`;

const SKETCH_TEMPLATE = `The attached image is a rough hand-drawn sketch of a human pose the user imagines. It may be a classic stick figure, but the user may also draw a thicker torso, blob-like body masses, contour outlines, or other loose shorthand — read it as a human figure, not literal lines. {HINT}Red text or red arrows in the image, if any, are the user's annotations (labels naming body parts, movement direction), NOT body parts — use them to resolve ambiguity.

First, briefly describe in a few sentences the pose you see: which way the figure faces, what each arm and leg is doing, and which limb is the figure's left vs right. Then output a JSON object (no markdown fences) in this exact schema as the LAST thing in your reply. Omit fields that are 0/default.

${SCHEMA_AND_CONVENTIONS}

LEFT/RIGHT RULES — read carefully, mirror mistakes are the most common error:
- "left"/"right" always mean the FIGURE's anatomical left/right.
- Front view (turn 0): the figure faces the viewer, so the figure's RIGHT arm/leg appears on the viewer's LEFT side of the image.
- Side view: first decide the facing from the drawing (head/feet direction). Figure drawn facing the viewer's RIGHT → turn: -90, and you are seeing its LEFT side, so the limbs drawn nearer/foremost are usually its LEFT limbs unless annotated otherwise. Facing viewer's LEFT → turn: +90, you see its RIGHT side.
- In a running/walking pose, opposite arm and leg swing forward (left arm forward pairs with right leg forward).

Estimate angles from the drawn limb directions. End your reply with the JSON object.`;

const TEXT_TEMPLATE = `The user describes a human pose they imagine, in words: 「{HINT}」

Interpret the description into a concrete full-body pose. First, briefly describe in a few sentences the pose you picture: which way the figure faces, what each arm and leg is doing. Then output a JSON object (no markdown fences) in this exact schema as the LAST thing in your reply. Omit fields that are 0/default.

${SCHEMA_AND_CONVENTIONS}

LEFT/RIGHT RULES:
- "left"/"right" in the JSON always mean the FIGURE's anatomical left/right.
- If the description doesn't pin a side, pick the conventional one (e.g. right hand for waving) and keep the whole pose consistent.
- In a running/walking pose, opposite arm and leg swing forward (left arm forward pairs with right leg forward).

Fill in unspecified joints with natural values that fit the described action. End your reply with the JSON object.`;

export function buildPosePrompt(hint: string): string {
  const trimmed = hint.trim();
  const hintText = trimmed.length > 0
    ? `The user added this note about the pose: 「${trimmed}」. `
    : '';
  return SKETCH_TEMPLATE.replace('{HINT}', hintText);
}

/**
 * Text-only variant: no sketch attached, the hint alone describes the pose.
 * Callers must ensure the hint is non-empty.
 */
export function buildTextPosePrompt(hint: string): string {
  return TEXT_TEMPLATE.replace('{HINT}', hint.trim());
}
