import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaskRevealButton, MASK_PEEK_HOLD_MS } from './MaskRevealButton';

function setup(props: { masksHidden?: boolean; peeking?: boolean } = {}) {
  const onToggle = vi.fn();
  const onPeekStart = vi.fn();
  const onPeekEnd = vi.fn();
  const utils = render(
    <MaskRevealButton
      masksHidden={props.masksHidden ?? true}
      peeking={props.peeking ?? false}
      onToggle={onToggle}
      onPeekStart={onPeekStart}
      onPeekEnd={onPeekEnd}
    />,
  );
  const button = utils.container.querySelector('button')!;
  return { ...utils, button, onToggle, onPeekStart, onPeekEnd };
}

describe('MaskRevealButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a quick tap toggles and does not peek', () => {
    const { button, onToggle, onPeekStart, onPeekEnd } = setup();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(MASK_PEEK_HOLD_MS - 100);
    });
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPeekStart).not.toHaveBeenCalled();
    expect(onPeekEnd).not.toHaveBeenCalled();
  });

  it('a hold starts a peek and the release ends it, without toggling', () => {
    const { button, onToggle, onPeekStart, onPeekEnd } = setup();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(MASK_PEEK_HOLD_MS);
    });
    expect(onPeekStart).toHaveBeenCalledTimes(1);
    expect(onPeekEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('pointercancel mid-peek ends the peek', () => {
    const { button, onPeekEnd } = setup();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(MASK_PEEK_HOLD_MS);
    });
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
  });

  it('shows the revealed icon while peeking even though masks are hidden', () => {
    const hidden = setup({ masksHidden: true });
    expect(hidden.container.querySelector('svg.lucide-eye')).not.toBeNull();
    hidden.unmount();

    const peeking = setup({ masksHidden: true, peeking: true });
    expect(peeking.container.querySelector('svg.lucide-eye-off')).not.toBeNull();
  });

  it('keyboard activation (click with detail 0) toggles', () => {
    const { button, onToggle } = setup();
    fireEvent.click(button, { detail: 0 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    // A pointer-originated click (detail ≥ 1) is left to the pointer handlers.
    fireEvent.click(button, { detail: 1 });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
