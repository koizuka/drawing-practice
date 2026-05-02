import { describe, it, expect } from 'vitest';
import { computeFitDimensions, sha256Hex, HISTORY_IMAGE_MAX_EDGE } from './imageResize';

describe('computeFitDimensions', () => {
  it('returns source dimensions unchanged when already within bounds', () => {
    expect(computeFitDimensions(1024, 768, HISTORY_IMAGE_MAX_EDGE)).toEqual({ width: 1024, height: 768 });
  });

  it('scales down to fit the longest side when width is longer', () => {
    const { width, height } = computeFitDimensions(4000, 3000, 2048);
    expect(width).toBe(2048);
    expect(height).toBe(Math.round(3000 * (2048 / 4000)));
  });

  it('scales down to fit the longest side when height is longer', () => {
    const { width, height } = computeFitDimensions(3000, 4000, 2048);
    expect(height).toBe(2048);
    expect(width).toBe(Math.round(3000 * (2048 / 4000)));
  });

  it('preserves aspect ratio across extreme ratios', () => {
    const { width, height } = computeFitDimensions(8000, 100, 2048);
    expect(width).toBe(2048);
    expect(height).toBe(Math.max(1, Math.round(100 * (2048 / 8000))));
    // Aspect ratio roughly preserved (within rounding tolerance)
    const srcRatio = 8000 / 100;
    const dstRatio = width / height;
    expect(Math.abs(srcRatio - dstRatio) / srcRatio).toBeLessThan(0.05);
  });

  it('never collapses a dimension to zero due to rounding', () => {
    const { width, height } = computeFitDimensions(20000, 1, 2048);
    expect(height).toBeGreaterThanOrEqual(1);
    expect(width).toBe(2048);
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-char lowercase hex digest', async () => {
    const hash = await sha256Hex(new Blob(['hello']));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Known SHA-256 of "hello"
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns the same digest for byte-identical Blobs regardless of MIME type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const a = await sha256Hex(new Blob([bytes], { type: 'image/jpeg' }));
    const b = await sha256Hex(new Blob([bytes], { type: 'image/png' }));
    expect(a).toBe(b);
  });

  it('returns different digests for different content', async () => {
    const a = await sha256Hex(new Blob(['one']));
    const b = await sha256Hex(new Blob(['two']));
    expect(a).not.toBe(b);
  });
});
