/**
 * Best-effort refinement loop for a generated pose: measure the applied pose
 * on the mannequin, diagnose physical implausibilities, and ask the model to
 * correct them in the same conversation — bounded rounds, converging early
 * when the model returns the pose unchanged (its way of saying "this is
 * intentional", e.g. an airborne jump).
 *
 * Generic over the generation result type so the loop stays independent of
 * the Anthropic client (and trivially testable with fakes).
 */

import type { PoseJson } from './poseTypes';
import { buildValidationFeedback, type PoseMeasurement } from './poseValidation';

export const MAX_POSE_REFINE_ROUNDS = 2;

export interface PoseRefineOptions<G extends { pose: PoseJson }> {
  /**
   * Apply the pose to the mannequin and sample its landmarks. Returning null
   * skips validation entirely (model not loaded, run superseded).
   */
  measure: (pose: PoseJson) => PoseMeasurement | null;
  /** One correction round in the same conversation. May reject. */
  refine: (prior: G, feedback: string) => Promise<G>;
  /** UI hook, fired before the first correction request. */
  onRefineStart?: (round: number, feedback: string) => void;
  maxRounds?: number;
}

function samePose(a: PoseJson, b: PoseJson): boolean {
  // parsePoseJson builds objects in a fixed key order, so stringify is a
  // reliable deep-equality here.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Returns the refined generation, or the best result so far when a
 * correction request fails (refinement is an enhancement — a valid pose in
 * hand must never be lost to a failed follow-up). Abort errors DO propagate
 * so callers can distinguish cancellation.
 */
export async function refinePoseUntilValid<G extends { pose: PoseJson }>(
  initial: G,
  options: PoseRefineOptions<G>,
): Promise<G> {
  const maxRounds = options.maxRounds ?? MAX_POSE_REFINE_ROUNDS;
  let current = initial;
  for (let round = 1; round <= maxRounds; round++) {
    const measurement = options.measure(current.pose);
    if (!measurement) break;
    const feedback = buildValidationFeedback(measurement, current.pose);
    if (!feedback) break;
    console.debug(`[pose] validation round ${round}:`, feedback);
    options.onRefineStart?.(round, feedback);
    let refined: G;
    try {
      refined = await options.refine(current, feedback);
    }
    catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      console.warn('[pose] refinement request failed, keeping the unrefined pose:', e);
      break;
    }
    const unchanged = samePose(refined.pose, current.pose);
    current = refined;
    if (unchanged) break;
  }
  return current;
}
