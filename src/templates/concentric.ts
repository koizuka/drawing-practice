import { circle } from './builders';
import type { TraceTemplate } from './types';

const VIEW = 1000;

export const concentricTemplate: TraceTemplate = {
  id: 'bundle:concentric',
  titleKey: 'tmplConcentric',
  viewBox: { w: VIEW, h: VIEW },
  strokes: [
    circle(0, 0, 80),
    circle(0, 0, 160),
    circle(0, 0, 240),
    circle(0, 0, 320),
    circle(0, 0, 400),
  ],
};
