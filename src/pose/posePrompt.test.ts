import { describe, it, expect } from 'vitest';
import { buildPosePrompt, buildTextPosePrompt } from './posePrompt';

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
    expect(prompt).toContain('End your reply with the JSON object');
  });

  it('includes the girl-style sitting recipe with internal rotation', () => {
    const prompt = buildPosePrompt('');
    expect(prompt).toContain('onnanoko-zuwari');
    expect(prompt).toContain('INTERNAL rotation');
  });

  it('includes the all-fours recipe and the torso-relative ground-support rule', () => {
    const prompt = buildPosePrompt('');
    expect(prompt).toContain('yotsunbai');
    expect(prompt).toContain('relative to the TORSO');
    expect(prompt).toContain('bear weight');
    expect(prompt).toContain('"wrist"');
    expect(prompt).toContain('"bend"');
    expect(prompt).toContain('sakadachi');
    expect(prompt).toContain('"forearmTwist"');
  });

  it('includes the deep-squat recipe with the corrected sole-flat formula', () => {
    const prompt = buildPosePrompt('');
    expect(prompt).toContain('sonkyo');
    expect(prompt).toContain('ankle = kneeBend - forward');
    expect(prompt).not.toContain('ankle = forward - kneeBend');
  });

  it('documents shinTwist in the schema and leg conventions', () => {
    const prompt = buildPosePrompt('');
    expect(prompt).toContain('"shinTwist"');
    expect(prompt).toContain('tibial rotation');
  });
});

describe('buildTextPosePrompt', () => {
  it('interpolates the hint and keeps the shared schema', () => {
    const prompt = buildTextPosePrompt(' 両手を上げてジャンプ ');
    expect(prompt).toContain('「両手を上げてジャンプ」');
    expect(prompt).toContain('"elbowDirection"');
    expect(prompt).toContain('End your reply with the JSON object');
    expect(prompt).not.toContain('{HINT}');
    expect(prompt).not.toContain('attached image');
  });
});
