import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

interface UseLongPressOptions {
  /**
   * Fires after the press has been held for `ms` without significant movement.
   * Receives the element the handlers were attached to. We pass the element
   * (not the React synthetic event) because by the time the timer fires the
   * event's `currentTarget` has been reset to null — capturing the element
   * synchronously at pointerdown is the only reliable way to use it as e.g.
   * a Popover anchor.
   */
  onLongPress: (target: HTMLElement) => void;
  /** Fires on a quick tap that did not become a long press. */
  onClick?: (target: HTMLElement) => void;
  /** Hold duration in milliseconds before `onLongPress` fires. */
  ms?: number;
  /** Pointer movement (in CSS pixels) beyond which the press is cancelled. */
  moveTolerancePx?: number;
}

interface UseLongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Distinguishes a quick tap from a long-press hold without relying on the
 * native `contextmenu` event (which iOS Safari suppresses or fires
 * inconsistently for in-page elements). A timer started on `pointerdown`
 * fires `onLongPress` if still alive after `ms`; a release before the timer
 * runs is treated as a click. Movement beyond `moveTolerancePx` cancels the
 * gesture entirely so a scroll/drag does not get mistaken for either.
 */
export function useLongPress({
  onLongPress,
  onClick,
  ms = 500,
  moveTolerancePx = 8,
}: UseLongPressOptions): UseLongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const firedRef = useRef(false);
  const cancelledRef = useRef(false);
  const ignoredRef = useRef(false);
  const targetRef = useRef<HTMLElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Only handle the primary button on mouse; touch/pen always have button=0.
    // Track the ignore so the matching pointerup does not fall through to
    // onClick (which would otherwise treat e.g. a right-click as a tap).
    if (e.button !== 0) {
      ignoredRef.current = true;
      return;
    }
    ignoredRef.current = false;
    firedRef.current = false;
    cancelledRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    targetRef.current = e.currentTarget;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      const target = targetRef.current;
      if (target) onLongPress(target);
    }, ms);
  }, [clearTimer, ms, onLongPress]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (timerRef.current === null && !firedRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) {
      cancelledRef.current = true;
      clearTimer();
    }
  }, [clearTimer, moveTolerancePx]);

  const onPointerUp = useCallback(() => {
    if (ignoredRef.current) {
      ignoredRef.current = false;
      return;
    }
    const wasFired = firedRef.current;
    const wasCancelled = cancelledRef.current;
    const target = targetRef.current;
    clearTimer();
    if (!wasFired && !wasCancelled && target) {
      onClick?.(target);
    }
  }, [clearTimer, onClick]);

  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    // Suppress the OS context menu on long-press (iOS Safari, desktop right click).
    e.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
  };
}
