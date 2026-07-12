import { describe, expect, it } from 'vitest';
import type { KeyboardEvent } from 'react';
import { isSubmitEnter } from './imeSafeEnter';

function makeEvent(key: string, opts: { isComposing?: boolean; keyCode?: number } = {}): KeyboardEvent {
  return {
    key,
    nativeEvent: {
      isComposing: opts.isComposing ?? false,
      keyCode: opts.keyCode ?? (key === 'Enter' ? 13 : 0),
    },
  } as unknown as KeyboardEvent;
}

describe('isSubmitEnter', () => {
  it('accepts a plain Enter', () => {
    expect(isSubmitEnter(makeEvent('Enter'))).toBe(true);
  });

  it('rejects non-Enter keys', () => {
    expect(isSubmitEnter(makeEvent('a'))).toBe(false);
  });

  it('rejects Enter during IME composition (isComposing)', () => {
    expect(isSubmitEnter(makeEvent('Enter', { isComposing: true }))).toBe(false);
  });

  it('rejects the Safari IME-confirm Enter (isComposing false but keyCode 229)', () => {
    expect(isSubmitEnter(makeEvent('Enter', { isComposing: false, keyCode: 229 }))).toBe(false);
  });
});
