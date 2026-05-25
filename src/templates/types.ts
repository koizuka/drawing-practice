import type { TraceStroke } from '../trace/types';

export interface TraceTemplate {
  /** Stable ID. Bundled = 'bundle:<slug>'. */
  id: string;
  /** i18n key for the title shown in the picker. */
  titleKey: string;
  /** Logical content size; the viewBox is centered on world origin. */
  viewBox: { w: number; h: number };
  /**
   * Stroke targets in world coordinates (already shifted so the viewBox center
   * = (0, 0)). The picker renders these directly.
   */
  strokes: TraceStroke[];
}
