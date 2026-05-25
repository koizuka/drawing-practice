import { ellipse } from './builders';
import type { TraceTemplate } from './types';

const VIEW = 1000;

/** Same-sized ellipses at varying rotation angles — pose/foreshortening practice. */
export const ellipsesTemplate: TraceTemplate = {
  id: 'bundle:ellipses',
  titleKey: 'tmplEllipses',
  viewBox: { w: VIEW, h: VIEW },
  strokes: [
    ellipse(-300, -250, 130, 60, 0),
    ellipse(0, -250, 130, 60, Math.PI / 6),
    ellipse(300, -250, 130, 60, Math.PI / 3),
    ellipse(-300, 0, 130, 60, Math.PI / 2),
    ellipse(0, 0, 130, 60, -Math.PI / 6),
    ellipse(300, 0, 130, 60, -Math.PI / 3),
    ellipse(-200, 250, 160, 30, 0),
    ellipse(100, 250, 160, 100, Math.PI / 8),
    ellipse(380, 250, 80, 80, 0),
  ],
};
