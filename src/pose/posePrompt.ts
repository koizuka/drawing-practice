/**
 * Prompt for turning a stick-figure sketch (+ optional user hint) into a
 * PoseJson. Verified against the Phase-0 spike (spike/pose-llm/) — the schema,
 * conventions, and left/right rules here must stay in sync with poseTypes.ts
 * and poseMapping.ts.
 */

const PROMPT_TEMPLATE = `The attached image is a stick figure a user drew to describe a human pose they imagine. {HINT}Red text or red arrows in the image, if any, are the user's annotations (labels naming body parts, movement direction), NOT body parts — use them to resolve ambiguity.

Interpret the pose and output ONLY a JSON object (no markdown fences, no commentary) in this exact schema. Omit fields that are 0/default.

{
  "body": {
    "leanForward": number,   // + = torso leans forward, - = backward (range -45..90)
    "leanSide": number,      // + = leans toward figure's left
    "twist": number,         // + = shoulders twist toward figure's left
    "turn": number,          // whole-body facing, VIEWER-relative: 0 = faces the viewer; +90 = faces the viewer's LEFT (you then see the figure's RIGHT profile); -90 = faces the viewer's RIGHT (you see its LEFT profile)
    "crouch": number         // 0 = standing tall .. 1 = hips fully lowered. Deep squat = crouch 0.7-1.0 AND kneeBend 120-150 AND leg forward 90+
  },
  "head": { "nod": number /* + looks down */, "turn": number /* + toward figure's left */, "tilt": number },
  "leftArm":  { "raise": number, "forward": number, "elbowBend": number, "elbowDirection": "front"|"down"|"up"|"back" }
              OR { "touch": "hip"|"head"|"chest" }  // use touch when the hand is placed on that body part (e.g. hand on hip); it replaces the angle fields
  "rightArm": ... same ...,
  "leftLeg":  { "forward": number, "spread": number, "kneeBend": number },
  "rightLeg": ... same ...
}

LEFT/RIGHT RULES — read carefully, mirror mistakes are the most common error:
- "left"/"right" always mean the FIGURE's anatomical left/right.
- Front view (turn 0): the figure faces the viewer, so the figure's RIGHT arm/leg appears on the viewer's LEFT side of the image.
- Side view: first decide the facing from the drawing (head/feet direction). Figure drawn facing the viewer's RIGHT → turn: -90, and you are seeing its LEFT side, so the limbs drawn nearer/foremost are usually its LEFT limbs unless annotated otherwise. Facing viewer's LEFT → turn: +90, you see its RIGHT side.
- In a running/walking pose, opposite arm and leg swing forward (left arm forward pairs with right leg forward).

Arm conventions: "raise" = upper-arm angle from hanging straight down, measured in the body's coronal plane: 0 = at side, 90 = horizontal T, 180 = straight up. "forward" = rotation of that direction toward the figure's front: 0 = coronal plane, 90 = straight forward. "elbowBend": 0 = straight .. 150. "elbowDirection" = which way the forearm folds.

Leg conventions: "forward" = hip flexion: 0 = straight down, 90 = thigh horizontal front, negative = extended backward. "spread" = outward abduction. "kneeBend": 0 = straight, bends backward, up to 150.

NATURAL POSE BIAS — apply whenever the sketch leaves room for interpretation:
- Prefer relaxed, anatomically plausible joint configurations. Choose the reading a real human body would naturally take, not a literal geometric one.
- elbowDirection: 'front' folds the forearm toward the body's front — the natural default for most poses; use it when unsure. 'up' = upward curl (waving, flexing). 'down' = forearm hangs down from a raised upper arm. 'back' ONLY when the hand is clearly behind the body (e.g. arm swung back while running).
- Arms drawn as straight lines: elbowBend 0-15, no elbowDirection needed.
- Elbows and knees never bend beyond their natural range; knees only bend backward.

Estimate angles from the drawn limb directions. Output the JSON only.`;

export function buildPosePrompt(hint: string): string {
  const trimmed = hint.trim();
  const hintText = trimmed.length > 0
    ? `The user added this note about the pose: 「${trimmed}」. `
    : '';
  return PROMPT_TEMPLATE.replace('{HINT}', hintText);
}
