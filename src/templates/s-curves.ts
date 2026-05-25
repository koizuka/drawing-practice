import { smoothCurve } from './builders';
import type { TraceTemplate } from './types';

const VIEW = 1000;

/**
 * Vertical S-curves of varying amplitude — fundamental for figure / form
 * gesture drawing. Each is a single smooth open curve.
 */
export const sCurvesTemplate: TraceTemplate = {
  id: 'bundle:s-curves',
  titleKey: 'tmplSCurves',
  viewBox: { w: VIEW, h: VIEW },
  strokes: [
    // gentle S
    smoothCurve([
      { p0: { x: -380, y: -380 }, p1: { x: -340, y: -150 }, p2: { x: -420, y: 150 }, p3: { x: -380, y: 380 } },
    ]),
    // stronger S
    smoothCurve([
      { p0: { x: -180, y: -380 }, p1: { x: -50, y: -200 }, p2: { x: -300, y: 200 }, p3: { x: -180, y: 380 } },
    ]),
    // mirrored S
    smoothCurve([
      { p0: { x: 20, y: -380 }, p1: { x: -100, y: -150 }, p2: { x: 150, y: 150 }, p3: { x: 20, y: 380 } },
    ]),
    // horizontal S
    smoothCurve([
      { p0: { x: 180, y: -200 }, p1: { x: 380, y: -120 }, p2: { x: 180, y: 120 }, p3: { x: 380, y: 200 } },
    ]),
    // long double-bend curve
    smoothCurve([
      { p0: { x: -400, y: 0 }, p1: { x: -150, y: -180 }, p2: { x: 150, y: 180 }, p3: { x: 400, y: 0 } },
    ]),
  ],
};
