import { describe, it, expect, vi } from 'vitest';
import { refinePoseUntilValid } from './poseRefineLoop';
import type { PoseJson } from './poseTypes';
import type { PoseMeasurement } from './poseValidation';

interface Gen { pose: PoseJson; tag: string }

/** Measurement with the left foot deep below the floor (always diagnosable). */
const BAD: PoseMeasurement = {
  rest: { leftFoot: { x: 0, y: 0.08, z: 0 } },
  posed: { leftFoot: { x: 0, y: -0.2, z: 0 } },
};
/** Measurement that passes every check (standing foot exactly grounded). */
const GOOD: PoseMeasurement = {
  rest: { leftFoot: { x: 0, y: 0.08, z: 0 } },
  posed: { leftFoot: { x: 0, y: 0.08, z: 0 } },
};

describe('refinePoseUntilValid', () => {
  it('returns the initial result untouched when validation passes', async () => {
    const refine = vi.fn();
    const result = await refinePoseUntilValid<Gen>(
      { pose: {}, tag: 'initial' },
      { measure: () => GOOD, refine },
    );
    expect(result.tag).toBe('initial');
    expect(refine).not.toHaveBeenCalled();
  });

  it('skips validation entirely when measure returns null', async () => {
    const refine = vi.fn();
    const result = await refinePoseUntilValid<Gen>(
      { pose: {}, tag: 'initial' },
      { measure: () => null, refine },
    );
    expect(result.tag).toBe('initial');
    expect(refine).not.toHaveBeenCalled();
  });

  it('refines until the measurement passes', async () => {
    const measurements = [BAD, GOOD];
    let calls = 0;
    const onRefineStart = vi.fn();
    const result = await refinePoseUntilValid<Gen>(
      { pose: { body: { turn: 0 } }, tag: 'initial' },
      {
        measure: () => measurements[calls],
        refine: async (_prior, feedback) => {
          calls++;
          expect(feedback).toContain('BELOW the floor');
          return { pose: { body: { turn: calls } }, tag: `refined${calls}` };
        },
        onRefineStart,
      },
    );
    expect(result.tag).toBe('refined1');
    expect(onRefineStart).toHaveBeenCalledTimes(1);
  });

  it('stops when the model returns the pose unchanged (intentional pose)', async () => {
    const refine = vi.fn(async (prior: Gen) => ({ pose: prior.pose, tag: 'unchanged' }));
    const result = await refinePoseUntilValid<Gen>(
      { pose: { body: { crouch: 1 } }, tag: 'initial' },
      { measure: () => BAD, refine, maxRounds: 5 },
    );
    expect(refine).toHaveBeenCalledTimes(1);
    expect(result.tag).toBe('unchanged');
  });

  it('caps the number of correction rounds', async () => {
    let n = 0;
    const result = await refinePoseUntilValid<Gen>(
      { pose: { body: { turn: 0 } }, tag: 'initial' },
      {
        measure: () => BAD,
        refine: async () => {
          n++;
          return { pose: { body: { turn: n } }, tag: `refined${n}` };
        },
        maxRounds: 2,
      },
    );
    expect(n).toBe(2);
    expect(result.tag).toBe('refined2');
  });

  it('keeps the best result when a refinement request fails', async () => {
    const failure = new Error('network down');
    const onRefineError = vi.fn();
    const result = await refinePoseUntilValid<Gen>(
      { pose: {}, tag: 'initial' },
      {
        measure: () => BAD,
        refine: async () => {
          throw failure;
        },
        onRefineError,
      },
    );
    expect(result.tag).toBe('initial');
    expect(onRefineError).toHaveBeenCalledWith(failure, 1);
  });

  it('propagates aborts', async () => {
    const onRefineError = vi.fn();
    await expect(refinePoseUntilValid<Gen>(
      { pose: {}, tag: 'initial' },
      {
        measure: () => BAD,
        refine: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
        onRefineError,
      },
    )).rejects.toSatisfy((e: unknown) => e instanceof DOMException && e.name === 'AbortError');
    expect(onRefineError).not.toHaveBeenCalled();
  });
});
