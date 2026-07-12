import { describe, it, expect } from 'vitest';
import { buildPosePrompt } from './posePrompt';

describe('buildPosePrompt', () => {
  it('interpolates a non-empty hint', () => {
    const prompt = buildPosePrompt('深くしゃがんでいる');
    expect(prompt).toContain('「深くしゃがんでいる」');
    expect(prompt).not.toContain('{HINT}');
  });

  it('omits the hint sentence when the hint is blank', () => {
    const prompt = buildPosePrompt('   ');
    expect(prompt).not.toContain('{HINT}');
    expect(prompt).not.toContain('user added this note');
  });

  it('keeps the schema and left/right rules', () => {
    const prompt = buildPosePrompt('');
    expect(prompt).toContain('"elbowDirection"');
    expect(prompt).toContain('LEFT/RIGHT RULES');
    expect(prompt).toContain('Output the JSON only');
  });
});
