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
  /**
   * Fires when a gesture whose `onLongPress` already fired ends — on
   * `pointerup` / `pointercancel`, and on unmount if the hold is still active
   * (so a hold-to-reveal can never get stuck on). Never fires for a plain
   * click or a press cancelled before the timer.
   */
  onLongPressEnd?: () => void;
  /** Hold duration in milliseconds before `onLongPress` fires. */
  ms?: number;
  /** Pointer movement (in CSS pixels) beyond which the press is cancelled. */
  moveTolerancePx?: number;
}

interface UseLongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  // The event is optional: it is only used to match the initiating pointerId
  // (the consumer's element/state is captured at pointerdown).
  onPointerUp: (e?: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e?: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Distinguishes a quick tap from a long-press hold without relying on the
 * native `contextmenu` event (which iOS Safari suppresses or fires
 * inconsistently for in-page elements). A timer started on `pointerdown`
 * fires `onLongPress` if still alive after `ms`; a release before the timer
 * runs is treated as a click. Movement beyond `moveTolerancePx` cancels the
 * gesture entirely so a scroll/drag does not get mistaken for either.
 *
 * Only the pointer that started the press drives it: events from a second
 * concurrent pointer (another finger on the same button) are ignored until the
 * initiating pointer is released or cancelled, so they can neither end the
 * hold early nor produce a second click.
 */
export function useLongPress({
  onLongPress,
  onClick,
  onLongPressEnd,
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
  // pointerId of the press in progress; null when no press is being tracked.
  const activePointerIdRef = useRef<number | null>(null);
  // True between a fired onLongPress and its matching end (up/cancel/unmount).
  const holdActiveRef = useRef(false);
  // Latest-ref so the unmount cleanup calls the current callback without
  // re-subscribing the effect on every render.
  const onLongPressEndRef = useRef(onLongPressEnd);
  useEffect(() => {
    onLongPressEndRef.current = onLongPressEnd;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endHold = useCallback(() => {
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    onLongPressEndRef.current?.();
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      endHold();
    },
    [clearTimer, endHold],
  );

  // True when `e` comes from a pointer other than the one that started the
  // current press. A missing event / pointerId (synthetic callers) matches.
  const isOtherPointer = useCallback(
    (e?: ReactPointerEvent<HTMLElement>) =>
      e !== undefined &&
      activePointerIdRef.current !== null &&
      e.pointerId !== undefined &&
      e.pointerId !== activePointerIdRef.current,
    [],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // A second finger while a press is tracked is ignored. A new *primary*
      // pointer means every earlier pointer is gone (its up was missed), so it
      // is allowed to start over.
      if (isOtherPointer(e) && !e.isPrimary) return;
      activePointerIdRef.current = e.pointerId ?? null;
      // Only handle the primary button on mouse; touch/pen always have button=0.
      // Track the ignore so the matching pointerup does not fall through to
      // onClick (which would otherwise treat e.g. a right-click as a tap).
      if (e.button !== 0) {
        ignoredRef.current = true;
        return;
      }
      ignoredRef.current = false;
      // A new press while a previous hold is somehow still active (missed
      // pointerup) closes the old one first.
      endHold();
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
        if (target) {
          holdActiveRef.current = true;
          onLongPress(target);
        }
      }, ms);
    },
    [clearTimer, endHold, isOtherPointer, ms, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (isOtherPointer(e)) return;
      if (timerRef.current === null && !firedRef.current) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;
      if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) {
        cancelledRef.current = true;
        clearTimer();
      }
    },
    [clearTimer, isOtherPointer, moveTolerancePx],
  );

  const onPointerUp = useCallback(
    (e?: ReactPointerEvent<HTMLElement>) => {
      if (isOtherPointer(e)) return;
      activePointerIdRef.current = null;
      if (ignoredRef.current) {
        ignoredRef.current = false;
        return;
      }
      const wasFired = firedRef.current;
      const wasCancelled = cancelledRef.current;
      const target = targetRef.current;
      // Consume the gesture so a later stray pointerup (e.g. from an ignored
      // second pointer) cannot click again.
      targetRef.current = null;
      clearTimer();
      endHold();
      if (!wasFired && !wasCancelled && target) {
        onClick?.(target);
      }
    },
    [clearTimer, endHold, isOtherPointer, onClick],
  );

  const onPointerCancel = useCallback(
    (e?: ReactPointerEvent<HTMLElement>) => {
      if (isOtherPointer(e)) return;
      activePointerIdRef.current = null;
      targetRef.current = null;
      cancelledRef.current = true;
      clearTimer();
      endHold();
    },
    [clearTimer, endHold, isOtherPointer],
  );

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
