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

  it('clamps leg rotation to the symmetric hip range', () => {
    const pose = parsePoseJson('{"leftLeg":{"rotation":170},"rightLeg":{"rotation":-120}}');
    expect(pose.leftLeg?.rotation).toBe(90);
    expect(pose.rightLeg?.rotation).toBe(-90);
  });

  it('keeps deep internal rotation intact (girl-style sitting)', () => {
    const pose = parsePoseJson('{"leftLeg":{"rotation":-55},"rightLeg":{"rotation":-55}}');
    expect(pose.leftLeg?.rotation).toBe(-55);
    expect(pose.rightLeg?.rotation).toBe(-55);
  });

  it('clamps kneeBend to the 160-degree flexion limit', () => {
    const pose = parsePoseJson('{"leftLeg":{"kneeBend":155},"rightLeg":{"kneeBend":200}}');
    expect(pose.leftLeg?.kneeBend).toBe(155);
    expect(pose.rightLeg?.kneeBend).toBe(160);
  });

  it('clamps shinTwist and keeps in-range values', () => {
    const pose = parsePoseJson('{"leftLeg":{"shinTwist":35},"rightLeg":{"shinTwist":-100}}');
    expect(pose.leftLeg?.shinTwist).toBe(35);
    expect(pose.rightLeg?.shinTwist).toBe(-60);
  });

  it('clamps ankle to the flex range', () => {
    const pose = parsePoseJson('{"leftLeg":{"ankle":80},"rightLeg":{"ankle":-90}}');
    expect(pose.leftLeg?.ankle).toBe(45);
    expect(pose.rightLeg?.ankle).toBe(-60);
  });

  it('accepts the in/out elbow directions', () => {
    const pose = parsePoseJson('{"leftArm":{"elbowBend":90,"elbowDirection":"in"},"rightArm":{"elbowBend":90,"elbowDirection":"out"}}');
    expect(pose.leftArm?.elbowDirection).toBe('in');
    expect(pose.rightArm?.elbowDirection).toBe('out');
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

  it('picks the LAST JSON object, not a valid example embedded in the prose', () => {
    const raw = 'A raised arm would be {"raise": 90} in this schema.\nFinal pose:\n{"body":{"turn":-90},"rightArm":{"raise":45}}';
    expect(parsePoseJson(raw)).toEqual({ body: { turn: -90 }, rightArm: { raise: 45 } });
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
