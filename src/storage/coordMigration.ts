import type { Stroke } from '../drawing/types';
import type { GuideLine, GuideState, PerspectiveSettings } from '../guides/types';

/**
 * Translate every coordinate by `(dx, dy)`. Used to migrate legacy stored
 * strokes / guide lines from "world origin = content top-left" to "world
 * origin = content center" by passing `(-W/2, -H/2)`.
 */
function shiftStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return {
    points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    timestamp: stroke.timestamp,
  };
}

function shiftGuideLine(line: GuideLine, dx: number, dy: number): GuideLine {
  return {
    ...line,
    x1: line.x1 + dx,
    y1: line.y1 + dy,
    x2: line.x2 + dx,
    y2: line.y2 + dy,
  };
}

export function shiftStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => shiftStroke(s, dx, dy));
}

export function shiftGuideState(state: GuideState, dx: number, dy: number): GuideState {
  // The perspective anchor point is a world coordinate, so it shifts too —
  // both the active settings and every captured memory snapshot.
  const shiftPerspective = (p: PerspectiveSettings): PerspectiveSettings => ({
    ...p,
    centerX: p.centerX + dx,
    centerY: p.centerY + dy,
  });
  const { perspective, perspectiveMemories } = state.grid;
  return {
    grid:
      perspective || perspectiveMemories?.length
        ? {
            ...state.grid,
            ...(perspective ? { perspective: shiftPerspective(perspective) } : {}),
            ...(perspectiveMemories
              ? {
                  perspectiveMemories: perspectiveMemories.map((m) => ({
                    ...m,
                    settings: shiftPerspective(m.settings),
                  })),
                }
              : {}),
          }
        : state.grid,
    lines: state.lines.map((l) => shiftGuideLine(l, dx, dy)),
  };
}
