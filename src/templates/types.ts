import type { TraceStroke } from '../trace/types';
import type { MessageKey } from '../i18n';

export interface TraceTemplate {
  /** Stable ID. Bundled = 'bundle:<slug>'. */
  id: string;
  /**
   * i18n key for the title shown in the picker. Typed against the actual
   * MessageKey union so a missing translation fails at compile time instead
   * of falling back to the key string at runtime.
   */
  titleKey: MessageKey;
  /** Logical content size; the viewBox is centered on world origin. */
  viewBox: { w: number; h: number };
  /**
   * Stroke targets in world coordinates (already shifted so the viewBox center
   * = (0, 0)). The picker renders these directly.
   */
  strokes: TraceStroke[];
}
