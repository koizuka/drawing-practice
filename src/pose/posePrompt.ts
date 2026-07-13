/**
 * Prompts for turning a pose sketch (+ optional user hint) — or a hint text
 * alone — into a PoseJson. Verified against the Phase-0 spike
 * (spike/pose-llm/) — the schema, conventions, and left/right rules here must
 * stay in sync with poseTypes.ts and poseMapping.ts.
 */

/** Schema + joint conventions shared by the sketch and text-only prompts. */
const SCHEMA_AND_CONVENTIONS = `{
  "body": {
    "bend": number,          // hip hinge: pitches the PELVIS and the whole body forward as one rigid unit, spine staying STRAIGHT (range -180..180; 90 = flat-back bow, 180 = fully inverted / handstand). Legs are pelvis-relative, so when the feet or knees stay on the ground, add the same amount to each leg's "forward" to keep them under the body — or simply give the legs footAt/kneeAt targets, which are floor-anchored and unaffected by bend. Use bend to fold at the hips, leanForward to curve the spine.
    "leanForward": number,   // + = torso leans forward rounding/curving the spine, - = backward (range -45..90)
    "leanSide": number,      // + = leans toward figure's left
    "twist": number,         // + = shoulders twist toward figure's left
    "turn": number,          // whole-body facing, VIEWER-relative: 0 = faces the viewer; +90 = faces the viewer's LEFT (you then see the figure's RIGHT profile); -90 = faces the viewer's RIGHT (you see its LEFT profile)
    "crouch": number,        // 0 = standing tall .. 1 = hips fully lowered. With the legs omitted, crouch alone falls back to a generic synthesized squat; for a proper deep squat give explicit legs per the deep-squat recipe in Leg conventions
    "hipsHeight": number     // ABSOLUTE height of the hip joints above the floor, meters (standing ~0.80). Overrides crouch, and unlike crouch's limited drop it can bring the body all the way down — give it whenever the hips are far below standing: sitting on the floor 0.12-0.18, all-fours ~0.42, handstand 0.85-0.90. Always give the legs explicitly (angles or targets) alongside it.
  },
  "head": { "nod": number /* + looks down */, "turn": number /* + toward figure's left */, "tilt": number /* + = head tilts toward the figure's left shoulder */ },
  "leftArm":  { "raise": number, "forward": number, "elbowBend": number, "elbowDirection": "front"|"down"|"up"|"in"|"out", "wrist": number, "forearmTwist": number, "elbowAt": {"x": number, "y": number, "z": number}, "handAt": {"x": number, "y": number, "z": number} }
              OR { "touch": "hip"|"head"|"chest" }  // use touch when the hand is placed on that body part (e.g. hand on hip); it replaces the angle fields
  "rightArm": ... same ...,
  "leftLeg":  { "forward": number, "spread": number, "rotation": number, "kneeBend": number, "shinTwist": number, "ankle": number, "kneeAt": {"x": number, "y": number, "z": number}, "footAt": {"x": number, "y": number, "z": number}, "kneeDirection": "front"|"out"|"in" },
  "rightLeg": ... same ...
}

PLACEMENT TARGETS — the preferred way to pin a hand or foot somewhere specific (planted on the ground, supporting weight, resting on a body part, stepping to a spot): give the limb "handAt"/"footAt" (optionally "elbowAt"/"kneeAt") instead of angle fields, and the joint angles are solved by IK on the client — far more reliable than deriving chained angles yourself.
- Coordinates are FIGURE-relative, in meters for a figure about 1.6m tall (auto-rescaled to the model): origin on the floor directly below the hips, +y up, +x = the figure's LEFT, +z = the figure's front. The frame follows body.turn but NOT body.bend or the leans.
- Standing reference heights: hips ~0.80, chest ~1.10, shoulders ~1.30, top of head ~1.60. Reach: whole arm ~0.55 from the shoulder, whole leg ~0.75 from the hip joint. body.hipsHeight (preferred over crouch for low poses) pins the hips at an absolute height and body.bend pitches the shoulders far forward/down — place targets within reach of where the shoulder/hip sits in the POSED body, out-of-reach targets get clamped.
- "handAt"/"footAt" place the wrist/ankle joint. y = 0 means planted on the floor: the palm/sole is automatically laid flat with fingers/toes pointing forward, so omit wrist/forearmTwist/ankle for planted limbs (set them only to override, e.g. toes pointing back).
- When a target is present the limb's other angle fields (raise/forward/elbowBend; forward/spread/rotation/kneeBend) are ignored. "elbowDirection" still chooses which way the forearm folds; "kneeDirection" chooses which way the knee apex points ("front" default, "out"/"in"). Give "kneeAt" AND "footAt" together to pin a folded leg exactly (kneeling and sitting shapes).
- Use angle fields for free-swinging limbs (a wave, a running arm swing); use targets whenever the pose is defined by WHERE the hand/foot is (contact, support, precise placement) — including ordinary STANDING feet: footAt with y = 0 keeps the sole level even when the stance is wide, while angle-mode feet can only hinge and tilt with the shin.
- Touching or covering the figure's OWN body: the body is a VOLUME — place handAt ON its surface, never on the x=0/z=0 centerline (that is INSIDE the flesh). Standing surface reference points: crotch/groin {"x": 0, "y": 0.72, "z": 0.13}, belly {"x": 0, "y": 0.95, "z": 0.13}, chest {"x": ±0.04, "y": 1.20, "z": 0.17}, side of thigh {"x": ±0.13, "y": 0.60, "z": 0.05}. Add elbowDirection "in" — the forearm folds toward the midline to reach the spot, which bows the elbow apex OUTWARD away from the body ("out" does the opposite and drags the elbow into or behind the torso). The palm is laid against the body automatically for targets on the torso surface. Reach limit: a hanging wrist only gets down to about y 0.85, so for covering the groin keep the target as given — the arm extends toward it, the palm lands on the lower belly, and the hand (which hangs ~0.10 below the wrist) covers the spot. Add body.leanForward 10-15 to close the remaining gap. For hand-on-hip/head/chest the "touch" presets remain the simplest choice.

Arm conventions: "raise" = upper-arm angle from hanging straight down, measured in the body's coronal plane: 0 = at side, 90 = horizontal T, 180 = straight up. "forward" = rotation of that direction toward the figure's front: 0 = coronal plane, 90 = straight forward. "elbowBend": 0 = straight .. 150. "elbowDirection" = which way the forearm folds. "wrist" = wrist hinge relative to the forearm: + = the hand bends back (extension — the palm pushes away, as when pressing flat against the ground), - = curls inward (flexion); 0 = hand in line with the forearm (anatomical range about -80..90). "forearmTwist" = pronation/supination, a roll of the hand about the forearm's own axis: + = the palm rolls toward the body's front from its palm-down T-pose rest, - = toward the back; 180 = palm up (holding a tray). Arm angles are measured relative to the TORSO, not the world — when the body has leanForward or bend, the whole arm frame pitches with it. Whenever a hand is planted on the ground, bears weight (all-fours, push-up, handstand), or rests on/holds a body part that "touch" does not cover (knees, shins, ankles, thighs), do NOT use angle fields and do NOT omit the arm — give it a "handAt" target at that place (see PLACEMENT TARGETS); planted palms are laid flat with the fingers aimed automatically.

Leg conventions: "forward" = hip flexion: 0 = straight down, 90 = thigh horizontal front, negative = extended backward. "spread" = outward abduction. "rotation" = hip rotation about the thigh axis: + = external (knee and toes turn outward), - = internal; with the hip flexed and the knee bent, external rotation folds the shin across the body's front. "kneeBend": 0 = straight, bends backward, up to 160. "shinTwist" = tibial rotation, a twist of the lower leg about its own axis at the knee: + = foot/toes turn outward, - = inward; only meaningful when the knee is bent (anatomical range about -30..45); use it to aim the FEET when the knee fold already puts the shin where you want it. "ankle" = ankle flex relative to the shin: + = toes lift toward the shin (dorsiflexion), - = toes point away (plantarflexion); 0 = foot perpendicular to the shin. The foot follows the shin — when the sole should rest FLAT on the ground (heel down, toes forward), set ankle = kneeBend - forward so the sole stays level (0 when the shin is vertical; a deep squat therefore needs strong dorsiflexion, +30..45). The ankle has NO roll axis: with "spread" the sole tilts sideways with the shin, so any weight-bearing foot standing on flat ground is better given as footAt with y = 0 (see PLACEMENT TARGETS) — that levels the sole automatically, even in a wide stance. Cross-legged sitting (agura / lotus) = crouch 1, hipsHeight 0.15, and per leg: forward 90-110, spread 20-40, rotation 60-90, kneeBend 130-150. The two shins stack, not intersect: keep the legs symmetric in spread/rotation/kneeBend and differ ONLY in forward, by about 10-15 degrees (e.g. one leg 90, the other 103), so one folded shin rests on top of the other. Knee-hug sitting (taiiku-zuwari: sitting on the buttocks with the heels on the ground close to the body, thighs pressed against the chest, torso leaning forward, face raised, arms wrapped around the shins) = crouch 1, hipsHeight 0.15, body leanForward 25-35, head nod -15 (face up, compensating the lean), per leg: forward 135-145 (thighs against the chest), kneeBend equal to forward ±5 (keeps the shin vertical, heel under the knee — do NOT fold the heel under the buttocks), spread 0-10, ankle = kneeBend - forward (soles flat in the ground plane through the buttocks and heels — toes must not tilt up); per arm: raise 65-80, forward 85-90 (upper arms reach forward past the raised knees), elbowBend 80-100, elbowDirection "in" — the forearms reach to the far side of the shins and wrap toward the midline, just below the knees. Girl-style sitting (onnanoko-zuwari / petan-zuwari / W-sitting: sitting on the floor BETWEEN the heels — knees together pointing forward, thighs resting on the floor, shins splayed outward, feet beside the hips with toes pointing back) = crouch 1, hipsHeight 0.15, body leanForward 0 (the torso sits fully UPRIGHT — unlike knee-hug sitting, do NOT lean forward at all), per leg: forward 90-100 (thighs on the floor), spread 5-15, rotation -65 to -80 (deep INTERNAL rotation, negative — this lays the knee-fold plane flat so the shin sweeps outward ALONG the floor beside the hip instead of hanging down from the knee; do NOT use positive/external rotation here), kneeBend 145-155, shinTwist 25-40 (external — the toes point back and slightly outward beside the hips instead of curling inward), ankle -40 to -50 (toes point back along the floor). Do NOT compensate the hip angle across body and legs: leanForward stays 0 and forward stays 90-100 even if that opens the hip angle past 90 — the tilted-unit look (torso and thighs pivoted together) is wrong. Arms in this pose: omit them (relaxed hanging), or hands resting on the lap = per arm raise 10-15, forward 15-25, elbowBend 15-25 — the hands stay low near the thighs, never floating forward at chest height. Deep squat / crouching (shagamu, sonkyo: squatting on the feet with the hips low, NOT sitting on the floor) = crouch 1, hipsHeight 0.35-0.40, body leanForward 15-25 (counterbalance), head nod -10 to -20 (face up); per leg: kneeAt {"x": ±0.19, "y": 0.45, "z": 0.25} and footAt {"x": ±0.13, "y": 0, "z": 0.08} — feet flat under the body, knees high in front and slightly open. Do NOT set hipsHeight lower for a squat: below ~0.33 the knee folds past 150° and the shin visibly sinks into the thigh (a real deep squat compresses the calf; the rigid mannequin cannot). Arms in a squat rest LOW and in FRONT — never fold them behind the back: hands resting on the knees = per arm handAt {"x": ±0.19, "y": 0.50, "z": 0.26}; or arms hanging relaxed between the knees = raise 10-20, forward 40-60, elbowBend 0-10. All-fours / hands-and-knees (yotsunbai, crawling, cat pose) = bend 70-80 with leanForward 0-15 — the fold happens at the HIPS and the back stays straight and near horizontal; do NOT round the spine with a big leanForward. hipsHeight 0.40-0.45, head nod -40 to -55 (raises the face to look forward); per leg: kneeAt {"x": ±0.10, "y": 0.05, "z": 0} and footAt {"x": ±0.10, "y": 0.04, "z": -0.40} with ankle -50 (knees under the hips, shins flat along the ground pointing back, insteps down); per arm: handAt {"x": ±0.15, "y": 0, "z": 0.40} (the arms drop as columns from the shoulders to the ground under the chest, palms flat). Handstand (sakadachi) = bend 170-180 (the whole body pitches over fully inverted), hipsHeight 0.85-0.90, head nod -30 to -50 (face toward the hands); per arm: handAt {"x": ±0.12, "y": 0, "z": 0} (overhead columns down to the ground, palms flat); per leg: forward 0, kneeBend 0, ankle -20 to -40 (toes pointed). For a balanced split-leg handstand: one leg forward 20-30, the other forward -10 to -20.

NATURAL POSE BIAS — apply whenever the input leaves room for interpretation:
- Prefer relaxed, anatomically plausible joint configurations. Choose the reading a real human body would naturally take, not a literal geometric one.
- elbowDirection: 'front' folds the forearm toward the body's front — the natural default for most poses; use it when unsure. 'up' = upward curl (waving, flexing). 'down' = forearm hangs down from a raised upper arm. 'in' = forearm folds toward the body's midline — use for hugging, wrapping around the knees/shins, crossing the arms. 'out' = away from the midline. There is NO 'back': an elbow never bends backward. For an arm swung BEHIND the body (e.g. the rear arm while running), put the swing in the upper arm — negative "forward" (about -30 to -50) with a moderate elbowBend 40-70 and elbowDirection 'front' — so the forearm trails the upper arm backward with the hand behind the hip.
- Straight arms: elbowBend 0-15, no elbowDirection needed.
- Arms that aren't doing anything: OMIT them entirely — absent arms render as relaxed hanging at the sides (not a T-pose). Never output raise 90 unless the pose actually holds the arms out.
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
