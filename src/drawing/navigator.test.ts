import { ViewTransform } from './ViewTransform';
import { makeWorldToScreen, navigatorScale, worldUpScreenAngle } from './navigator';

const C = { width: 800, height: 600 };
const deg = (d: number) => (d * Math.PI) / 180;

describe('navigator geometry', () => {
  it('world up is screen up at rotation 0 and follows the rotation', () => {
    const vt = new ViewTransform();
    expect(worldUpScreenAngle(vt.projectMatrix(C, 1, true), false)).toBeCloseTo(0);
    vt.setRotationAbout(deg(30), 400, 300, C, 1, 'userRotate');
    expect(worldUpScreenAngle(vt.projectMatrix(C, 1, true), false)).toBeCloseTo(deg(30));
    // Mirrored view: the same canvas rotation reads counter-clockwise.
    expect(worldUpScreenAngle(vt.projectMatrix(C, 1, true), true)).toBeCloseTo(deg(-30));
  });

  it('worldToScreen applies the CSS flip', () => {
    const vt = new ViewTransform();
    const m = vt.projectMatrix(C, 1, true);
    expect(makeWorldToScreen(m, C.width, false)({ x: 100, y: 0 })).toEqual({ x: 500, y: 300 });
    expect(makeWorldToScreen(m, C.width, true)({ x: 100, y: 0 })).toEqual({ x: 300, y: 300 });
  });

  it('navigatorScale fits the viewport diagonal, or farther content', () => {
    // Viewport half-diagonal = 500.
    expect(navigatorScale(C, [], 50)).toBeCloseTo(0.1);
    expect(navigatorScale(C, [{ x: 400, y: 300 + 1000 }], 50)).toBeCloseTo(0.05);
  });
});
