import { describe, it, expect } from 'vitest';
import { scoreAttempt, SCORING_N } from './scoring';
import { polylineLength } from './resample';
import type { Stroke } from '../drawing/types';
import type { TraceStroke } from './types';

function ring(r: number, n: number, cx = 0, cy = 0): TraceStroke {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  pts.push({ x: pts[0].x, y: pts[0].y });
  return { points: pts, length: polylineLength(pts), closed: true };
}

function line(from: { x: number; y: number }, to: { x: number; y: number }, n: number): TraceStroke {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return { points: pts, length: polylineLength(pts), closed: false };
}

function userStroke(pts: { x: number; y: number }[]): Stroke {
  return { points: pts.map(p => ({ ...p })), timestamp: 0 };
}

describe('scoreAttempt — open templates', () => {
  it('matches a perfect trace of an open line with ~0 error', () => {
    const tpl = line({ x: 0, y: 0 }, { x: 100, y: 0 }, 16);
    const user = userStroke(tpl.points);
    const m = scoreAttempt(user, [tpl]);
    expect(m).not.toBeNull();
    expect(m!.templateStrokeIdx).toBe(0);
    expect(m!.errorPct).toBeLessThan(0.5);
    expect(m!.userSamples).toHaveLength(SCORING_N + 1);
  });

  it('matches a reverse-direction trace', () => {
    const tpl = line({ x: 0, y: 0 }, { x: 100, y: 0 }, 16);
    const user = userStroke([...tpl.points].reverse());
    const m = scoreAttempt(user, [tpl]);
    expect(m).not.toBeNull();
    expect(m!.errorPct).toBeLessThan(0.5);
  });

  it('rejects a trace whose endpoints are too far from the template', () => {
    const tpl = line({ x: 0, y: 0 }, { x: 100, y: 0 }, 16);
    const user = userStroke([{ x: 200, y: 0 }, { x: 300, y: 0 }]);
    expect(scoreAttempt(user, [tpl])).toBeNull();
  });
});

describe('scoreAttempt — closed templates', () => {
  it('matches a circle traced from 12 oclock clockwise', () => {
    const tpl = ring(100, 96);
    // 12 oclock = (0, -100). Clockwise: angle goes from -pi/2 to 3pi/2 (or -pi/2 - 2pi)
    const user: { x: number; y: number }[] = [];
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = -Math.PI / 2 - 2 * Math.PI * t;
      user.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
    }
    const m = scoreAttempt(userStroke(user), [tpl]);
    expect(m).not.toBeNull();
    expect(m!.errorPct).toBeLessThan(0.5);
  });

  it('matches a circle traced from 3 oclock counter-clockwise', () => {
    const tpl = ring(100, 96);
    const user: { x: number; y: number }[] = [];
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = 0 + 2 * Math.PI * t;
      user.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
    }
    const m = scoreAttempt(userStroke(user), [tpl]);
    expect(m).not.toBeNull();
    expect(m!.errorPct).toBeLessThan(0.5);
  });

  it('rejects a half circle (not closed) for a closed template', () => {
    const tpl = ring(100, 96);
    const user: { x: number; y: number }[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = 0 + Math.PI * t;
      user.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
    }
    expect(scoreAttempt(userStroke(user), [tpl])).toBeNull();
  });

  it('picks the closest of multiple concentric circles', () => {
    const small = ring(50, 96);
    const large = ring(200, 96);
    // Trace the large one
    const user: { x: number; y: number }[] = [];
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = -Math.PI / 2 - 2 * Math.PI * t;
      user.push({ x: 200 * Math.cos(a), y: 200 * Math.sin(a) });
    }
    const m = scoreAttempt(userStroke(user), [small, large]);
    expect(m).not.toBeNull();
    expect(m!.templateStrokeIdx).toBe(1);
  });
});
