import type { KeyboardEvent } from 'react';

/**
 * True when an Enter keydown is a real submit, not an IME composition confirm.
 * `isComposing` alone is insufficient: Safari delivers `compositionend` before
 * the final keydown, so that keydown reports `isComposing === false` — but it
 * still carries the legacy IME keyCode 229, which is the remaining signal.
 */
export function isSubmitEnter(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229;
}
