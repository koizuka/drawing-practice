import { LassoState } from './lassoState';
import type { Stroke } from './types';

const stroke = (pts: [number, number][], timestamp = 0): Stroke =>
  ({ points: pts.map(([x, y]) => ({ x, y })), timestamp }) as Stroke;

/** Square path (0,0)–(10,10). */
function drawSquare(l: LassoState) {
  l.start({ x: 0, y: 0 });
  l.append({ x: 10, y: 0 });
  l.append({ x: 10, y: 10 });
  l.append({ x: 0, y: 10 });
}

describe('LassoState', () => {
  it('is inactive until started and after clear', () => {
    const l = new LassoState();
    expect(l.active).toBe(false);
    l.start({ x: 0, y: 0 });
    expect(l.active).toBe(true);
    l.clear();
    expect(l.active).toBe(false);
    expect(l.selected).toBeNull();
  });

  it('ignores append while inactive', () => {
    const l = new LassoState();
    l.append({ x: 1, y: 1 });
    expect(l.points).toBeNull();
  });

  it('selects only strokes fully inside the polygon', () => {
    const l = new LassoState();
    drawSquare(l);
    const strokes = [
      stroke([
        [2, 2],
        [8, 8],
      ]),
      stroke([
        [2, 2],
        [12, 8],
      ]), // pokes out
      stroke([
        [20, 20],
        [25, 25],
      ]), // outside the bbox
      stroke([]), // empty strokes never match
    ];
    l.recomputeSelection(strokes, () => true);
    expect([...l.selected!]).toEqual([0]);
  });

  it('never selects non-editable strokes', () => {
    const l = new LassoState();
    drawSquare(l);
    const strokes = [
      stroke(
        [
          [2, 2],
          [3, 3],
        ],
        1,
      ),
      stroke(
        [
          [4, 4],
          [5, 5],
        ],
        2,
      ),
    ];
    l.recomputeSelection(strokes, (st) => st.timestamp !== 1);
    expect([...l.selected!]).toEqual([1]);
  });

  it('has no selection until the path has 3 vertices', () => {
    const l = new LassoState();
    l.start({ x: 0, y: 0 });
    l.append({ x: 10, y: 0 });
    l.recomputeSelection([stroke([[5, 0]])], () => true);
    expect(l.selected).toBeNull();
  });

  it('finish returns ascending targets and resets', () => {
    const l = new LassoState();
    drawSquare(l);
    l.recomputeSelection([stroke([[1, 1]]), stroke([[50, 50]]), stroke([[9, 9]])], () => true);
    expect(l.finish()).toEqual([0, 2]);
    expect(l.active).toBe(false);
    expect(l.selected).toBeNull();
  });

  it('finish returns null when nothing is enclosed', () => {
    const l = new LassoState();
    drawSquare(l);
    l.recomputeSelection([stroke([[50, 50]])], () => true);
    expect(l.finish()).toBeNull();
    expect(l.active).toBe(false);
  });

  it('start resets the dash phase; advanceDash wraps', () => {
    const l = new LassoState();
    for (let i = 0; i < 2049; i++) l.advanceDash();
    expect(l.dashPhase).toBeLessThan(1024);
    l.start({ x: 0, y: 0 });
    expect(l.dashPhase).toBe(0);
  });
});
