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

  it('clamps leg rotation to the hip range', () => {
    const pose = parsePoseJson('{"leftLeg":{"rotation":170},"rightLeg":{"rotation":-80}}');
    expect(pose.leftLeg?.rotation).toBe(90);
    expect(pose.rightLeg?.rotation).toBe(-30);
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

  it('extracts the JSON even when the leading prose contains braces', () => {
    const raw = 'The figure {as drawn} faces left, arms in a T shape.\n\n{"body":{"turn":90},"leftArm":{"raise":90}}';
    expect(parsePoseJson(raw)).toEqual({ body: { turn: 90 }, leftArm: { raise: 90 } });
  });

  it('extracts the JSON when prose braces appear both before and after it', () => {
    const raw = 'Analysis {rough}:\n{"head":{"nod":20}}\ntrailing note {end}';
    expect(parsePoseJson(raw)).toEqual({ head: { nod: 20 } });
  });

  it('throws PoseParseError when no JSON object is present', () => {
    expect(() => parsePoseJson('sorry, I cannot')).toThrow(PoseParseError);
  });

  it('throws PoseParseError on malformed JSON', () => {
    expect(() => parsePoseJson('{"leftArm":{')).toThrow(PoseParseError);
  });
});
