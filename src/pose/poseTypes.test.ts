import { describe, it, expect } from 'vitest';
import { parsePoseJson, PoseParseError } from './poseTypes';

describe('parsePoseJson', () => {
  it('parses a plain JSON object', () => {
    const pose = parsePoseJson('{"leftArm":{"raise":90,"elbowBend":45}}');
    expect(pose.leftArm).toEqual({ raise: 90, elbowBend: 45 });
  });

  it('strips markdown code fences and surrounding prose', () => {
    const raw = 'Here is the pose:\n```json\n{"body":{"turn":-90}}\n```\nDone.';
    expect(parsePoseJson(raw)).toEqual({ body: { turn: -90 } });
  });

  it('clamps out-of-range numbers', () => {
    const pose = parsePoseJson('{"leftArm":{"raise":999},"body":{"crouch":5}}');
    expect(pose.leftArm?.raise).toBe(180);
    expect(pose.body?.crouch).toBe(1);
  });

  it('drops unknown keys, invalid enums, and non-numeric values', () => {
    const pose = parsePoseJson(JSON.stringify({
      leftArm: { raise: 'high', elbowDirection: 'sideways', elbowBend: 30, wiggle: 1 },
      tail: { curl: 90 },
    }));
    expect(pose.leftArm).toEqual({ elbowBend: 30 });
    expect(Object.keys(pose)).toEqual(['leftArm']);
  });

  it('accepts touch presets', () => {
    const pose = parsePoseJson('{"rightArm":{"touch":"hip"}}');
    expect(pose.rightArm).toEqual({ touch: 'hip' });
  });

  it('drops sections that end up empty after sanitizing', () => {
    const pose = parsePoseJson('{"head":{"nod":"yes"},"leftLeg":{"forward":30}}');
    expect(pose.head).toBeUndefined();
    expect(pose.leftLeg).toEqual({ forward: 30 });
  });

  it('throws PoseParseError when no JSON object is present', () => {
    expect(() => parsePoseJson('sorry, I cannot')).toThrow(PoseParseError);
  });

  it('throws PoseParseError on malformed JSON', () => {
    expect(() => parsePoseJson('{"leftArm":{')).toThrow(PoseParseError);
  });
});
