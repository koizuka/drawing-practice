import { describe, expect, it } from 'vitest';
import { evaluateFreezeHint, type FreezeHintInput, type FreezeHintThresholds } from './freezeHintLogic';

const TH: FreezeHintThresholds = { streakMs: 15_000, silenceMs: 4_000, maxVisibleMs: 4_000 };
const RECT = { left: 0, top: 0, width: 400, height: 300 };

// A baseline "freeze in progress": a 15s streak ended (lastInputAt=15000 with
// streakStartAt=0), then the test picks `now` to set the silence.
function frozen(overrides: Partial<FreezeHintInput> = {}): FreezeHintInput {
  return {
    lastInputAt: 15_000,
    streakStartAt: 0,
    client: { x: 200, y: 150 },
    containerRect: RECT,
    ...overrides,
  };
}

describe('evaluateFreezeHint', () => {
  it('shows the hint after a long streak once input has been silent past the threshold', () => {
    const r = evaluateFreezeHint(frozen(), 19_000, TH); // silence = 4000 = SILENCE_MS
    expect(r.visible).toBe(true);
    // Anchor is the last draw point (centered, well within bounds).
    expect(r).toMatchObject({ x: 200, y: 150 });
  });

  it('stays hidden if the continuous-draw streak was too short (casual drawing + pause)', () => {
    const r = evaluateFreezeHint(frozen({ lastInputAt: 10_000, streakStartAt: 0 }), 14_000, TH); // streak 10s < 15s
    expect(r.visible).toBe(false);
  });

  it('stays hidden while input is recent (silence below the threshold)', () => {
    const r = evaluateFreezeHint(frozen(), 16_000, TH); // silence = 1000 < 4000
    expect(r.visible).toBe(false);
  });

  it('auto-hides once the visible window has elapsed (so it never lingers after a session)', () => {
    // silence = 8000 = SILENCE_MS + MAX_VISIBLE_MS (exclusive upper bound)
    const r = evaluateFreezeHint(frozen(), 23_000, TH);
    expect(r.visible).toBe(false);
  });

  it('is visible right up to (but not including) the end of the window', () => {
    expect(evaluateFreezeHint(frozen(), 22_999, TH).visible).toBe(true);
    expect(evaluateFreezeHint(frozen(), 23_000, TH).visible).toBe(false);
  });

  it('stays hidden when there is no known draw position or container rect', () => {
    expect(evaluateFreezeHint(frozen({ client: null }), 19_000, TH).visible).toBe(false);
    expect(evaluateFreezeHint(frozen({ containerRect: null }), 19_000, TH).visible).toBe(false);
  });

  it('clamps the anchor inside the container so the pill stays on-screen near edges', () => {
    // Top-left corner touch: clamps up to the reserved margins.
    const tl = evaluateFreezeHint(frozen({ client: { x: 0, y: 0 } }), 19_000, TH);
    expect(tl.visible).toBe(true);
    expect(tl.x).toBe(128); // EST_HALF_W(120) + MARGIN(8)
    expect(tl.y).toBe(60); //  EST_ABOVE(52) + MARGIN(8)

    // Bottom-right corner touch: clamps to width/height minus reserve.
    const br = evaluateFreezeHint(frozen({ client: { x: 400, y: 300 } }), 19_000, TH);
    expect(br.x).toBe(400 - 128);
    expect(br.y).toBe(300 - 8);
  });

  it('centers the pill when the container is too narrow to honor the edge reserve', () => {
    // width 200 < 2*(EST_HALF_W+MARGIN)=256 → no valid clamp range → center at width/2.
    const r = evaluateFreezeHint(
      frozen({ client: { x: 10, y: 150 }, containerRect: { left: 0, top: 0, width: 200, height: 300 } }),
      19_000,
      TH,
    );
    expect(r.visible).toBe(true);
    expect(r.x).toBe(100); // width / 2, not pinned to the left edge
  });

  it('translates client coords to container-relative using the container offset', () => {
    const r = evaluateFreezeHint(
      frozen({ client: { x: 250, y: 200 }, containerRect: { left: 50, top: 40, width: 400, height: 300 } }),
      19_000,
      TH,
    );
    // rel = (250-50, 200-40) = (200, 160), within bounds → unclamped.
    expect(r).toMatchObject({ visible: true, x: 200, y: 160 });
  });
});
