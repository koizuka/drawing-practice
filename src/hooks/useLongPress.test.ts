import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLongPress } from './useLongPress';

function fakePointerEvent(overrides: Partial<ReactPointerEvent<HTMLElement>> = {}): ReactPointerEvent<HTMLElement> {
  const target = (overrides.currentTarget ?? document.createElement('button')) as HTMLElement;
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: target,
    ...overrides,
  } as ReactPointerEvent<HTMLElement>;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onLongPress with the captured element after the hold duration', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick, ms: 500 }));

    const target = document.createElement('button');
    act(() => result.current.onPointerDown(fakePointerEvent({ currentTarget: target })));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(target);

    act(() => result.current.onPointerUp());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('captures currentTarget synchronously so it survives async timer firing', () => {
    // Simulates React resetting the synthetic event's currentTarget to null
    // after the dispatch phase, which is what was breaking iPhone long-press.
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, ms: 500 }));

    const target = document.createElement('button');
    const event = fakePointerEvent({ currentTarget: target });
    act(() => result.current.onPointerDown(event));
    // Mimic React clearing currentTarget once dispatch completes.
    Object.defineProperty(event, 'currentTarget', { value: null });

    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledWith(target);
  });

  it('fires onClick with the captured element on a quick release', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick, ms: 500 }));

    const target = document.createElement('button');
    act(() => result.current.onPointerDown(fakePointerEvent({ currentTarget: target })));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.onPointerUp());

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(target);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the press when the pointer moves beyond the tolerance', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, onClick, ms: 500, moveTolerancePx: 8 }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 0, clientY: 0 })));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 20, clientY: 0 })));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => result.current.onPointerUp());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the press alive for movements within the tolerance', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, ms: 500, moveTolerancePx: 8 }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 0, clientY: 0 })));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels via onPointerCancel', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick, ms: 500 }));

    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerCancel());
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).not.toHaveBeenCalled();
    act(() => result.current.onPointerUp());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('preventDefault is called on contextmenu', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    const e = { preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLElement>;
    act(() => result.current.onContextMenu(e));
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('does not fire onClick on a non-primary mouse button release', () => {
    // Right-click should not switch tools just because it released.
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick }));

    act(() => result.current.onPointerDown(fakePointerEvent({ button: 2 })));
    act(() => { vi.advanceTimersByTime(500); });
    act(() => result.current.onPointerUp());

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not double-fire onClick after onLongPress', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick, ms: 500 }));

    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => { vi.advanceTimersByTime(500); });
    act(() => result.current.onPointerUp());

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
