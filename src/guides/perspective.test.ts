import { describe, it, expect } from 'vitest';
import { computePerspectiveGridLines, type PerspectiveSegment } from './perspective';
import { DEFAULT_PERSPECTIVE, type PerspectiveSettings } from './types';

function settings(patch: Partial<PerspectiveSettings> = {}): PerspectiveSettings {
  return { ...DEFAULT_PERSPECTIVE, ...patch };
}

function allCoords(lines: PerspectiveSegment[]): number[] {
  return lines.flatMap((l) => [l.x1, l.y1, l.x2, l.y2]);
}

describe('computePerspectiveGridLines', () => {
  it('returns segments with only finite coordinates for the default view', () => {
    const lines = computePerspectiveGridLines(settings());
    expect(lines.length).toBeGreaterThan(0);
    for (const c of allCoords(lines)) {
      expect(Number.isFinite(c)).toBe(true);
    }
  });

  it('is left-right symmetric at yaw=0, pitch=0', () => {
    const lines = computePerspectiveGridLines(settings());
    // For every segment there is a mirrored counterpart under x → -x.
    const keys = new Set(
      lines.map((l) => {
        const pts = [
          [l.x1, l.y1],
          [l.x2, l.y2],
        ]
          .map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`)
          .sort();
        return pts.join('|');
      }),
    );
    for (const l of lines) {
      const mirrored = [
        [-l.x1, l.y1],
        [-l.x2, l.y2],
      ]
        .map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`)
        .sort()
        .join('|');
      expect(keys.has(mirrored)).toBe(true);
    }
  });

  // The floor is emitted first, alternating depth-running (parallel to z)
  // and width-running (parallel to x) lines per offset — 18 segments total.
  // A tilted view (pitch=30) keeps the floor visibly open in both projections.
  function floorDepthLines(lines: PerspectiveSegment[]): PerspectiveSegment[] {
    return lines.slice(0, 18).filter((_, i) => i % 2 === 0);
  }

  function depthAngleSpread(strength: number): number {
    const lines = computePerspectiveGridLines(settings({ pitch: 30, strength }));
    const depth = floorDepthLines(lines);
    expect(depth.length).toBe(9);
    const angles = depth.map((l) => {
      const a = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
      return ((a % Math.PI) + Math.PI) % Math.PI;
    });
    return Math.max(...angles) - Math.min(...angles);
  }

  it('approaches parallel projection as strength → 0', () => {
    // Under parallel projection the depth-running floor lines stay parallel:
    // direction angles (mod π) have small spread. strength=0 keeps a 1° half
    // field of view, so a small residual convergence remains by design.
    const nearParallel = depthAngleSpread(0);
    expect(nearParallel).toBeLessThan(0.1);
    // ...and it should be far smaller than the wide-angle setting's spread.
    expect(nearParallel).toBeLessThan(depthAngleSpread(1) / 5);
  });

  it('converges depth lines toward a vanishing point at high strength', () => {
    const lines = computePerspectiveGridLines(settings({ pitch: 30, strength: 1 }));
    const depth = floorDepthLines(lines);
    expect(depth.length).toBe(9);
    const nearXs: number[] = [];
    const farXs: number[] = [];
    for (const l of depth) {
      // The endpoint lower on screen (larger y) is nearer to the camera.
      if (l.y1 > l.y2) {
        nearXs.push(l.x1);
        farXs.push(l.x2);
      } else {
        nearXs.push(l.x2);
        farXs.push(l.x1);
      }
    }
    const width = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(width(farXs)).toBeLessThan(width(nearXs) * 0.9);
  });

  it('produces finite coordinates near ±90° rotations and full strength', () => {
    for (const yaw of [-90, -89.9, 0, 89.9, 90]) {
      for (const pitch of [-90, -89.9, 0, 89.9, 90]) {
        const lines = computePerspectiveGridLines(settings({ yaw, pitch, strength: 1 }));
        for (const c of allCoords(lines)) {
          expect(Number.isFinite(c)).toBe(true);
        }
      }
    }
  });

  it('translates all segments by (centerX, centerY)', () => {
    const base = computePerspectiveGridLines(settings());
    const moved = computePerspectiveGridLines(settings({ centerX: 250, centerY: -120 }));
    expect(moved.length).toBe(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(moved[i].x1).toBeCloseTo(base[i].x1 + 250, 6);
      expect(moved[i].y1).toBeCloseTo(base[i].y1 - 120, 6);
      expect(moved[i].x2).toBeCloseTo(base[i].x2 + 250, 6);
      expect(moved[i].y2).toBeCloseTo(base[i].y2 - 120, 6);
    }
  });

  it('returns the cached array for identical settings values', () => {
    const a = computePerspectiveGridLines(settings({ yaw: 10, pitch: 5 }));
    const b = computePerspectiveGridLines(settings({ yaw: 10, pitch: 5 }));
    expect(b).toBe(a);
    const c = computePerspectiveGridLines(settings({ yaw: 11, pitch: 5 }));
    expect(c).not.toBe(a);
  });

  it('culls near walls so the interior stays visible (fewer segments than all five faces)', () => {
    const lines = computePerspectiveGridLines(settings());
    // Floor = 18 segments; each wall = (9 vertical + 4 horizontal) = 13.
    // With front wall culled at yaw=0 we expect at most floor + 3 walls.
    expect(lines.length).toBeLessThanOrEqual(18 + 3 * 13);
    expect(lines.length).toBeGreaterThanOrEqual(18 + 13); // at least floor + back wall
  });
});
