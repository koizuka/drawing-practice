import { smoothCurve } from './builders';
import type { TraceTemplate } from './types';

const VIEW = 1000;

/**
 * A bundle of fan-shaped flowing curves — practice for confident long
 * tapering strokes (hair, fur, drapery).
 */
function strand(startX: number, ctrl1X: number, ctrl2X: number, endX: number, sway: number) {
  return smoothCurve([
    {
      p0: { x: startX, y: -420 },
      p1: { x: ctrl1X + sway * 0.4, y: -120 },
      p2: { x: ctrl2X - sway * 0.7, y: 180 },
      p3: { x: endX, y: 420 },
    },
  ]);
}

export const hairlinesTemplate: TraceTemplate = {
  id: 'bundle:hairlines',
  titleKey: 'tmplHairlines',
  viewBox: { w: VIEW, h: VIEW },
  strokes: [
    strand(-380, -350, -260, -180, -40),
    strand(-260, -240, -150, -80, -20),
    strand(-130, -120, -50, 30, 0),
    strand(0, 10, 80, 160, 20),
    strand(130, 140, 200, 280, 40),
    strand(260, 280, 340, 410, 60),
    strand(380, 400, 420, 440, 30),
  ],
};
