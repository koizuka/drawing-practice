import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ContainerSize, ViewTransform } from '../drawing/ViewTransform';
import { nextRotationStep, ROTATION_ANIM_MS, shortestAngleDelta } from '../drawing/rotation';

/**
 * Discrete rotation request from outside the canvas (keyboard shortcut,
 * navigator ▲ tap). `seq` must increase per request so repeating the same
 * command re-fires. `dir` is a SCREEN direction (+1 = clockwise as seen);
 * the canvas converts for the horizontal flip.
 */
export type RotationCommand =
  | { seq: number; kind: 'reset' }
  | { seq: number; kind: 'step'; dir: 1 | -1 };

interface UseRotationAnimationOptions {
  viewTransformRef: RefObject<ViewTransform>;
  containerSizeRef: RefObject<ContainerSize>;
  getBaseScale: () => number;
  requestRedraw: () => void;
  /** Latest discrete rotation request; applied once per new `seq`. */
  rotationCommand: RotationCommand | null;
  isFlipped: boolean | undefined;
}

/**
 * Drawing-panel rotation animation (snap on pinch release, ▲ reset, keyboard
 * steps). Intermediate frames emit 'gesture' (tail-debounced save), the last
 * frame 'userRotate' (immediate save). A reset / content load / restore that
 * lands mid-animation cancels it.
 *
 * Also consumes `rotationCommand`: pivot = canvas center, not gated by the
 * pinch-rotate switch (that only guards against an unintended twist during a
 * pinch; a key press or tap is always deliberate).
 */
export function useRotationAnimation({
  viewTransformRef,
  containerSizeRef,
  getBaseScale,
  requestRedraw,
  rotationCommand,
  isFlipped,
}: UseRotationAnimationOptions) {
  const rotationAnimRafRef = useRef(0);
  // Where a running animation is heading, so a key press that arrives
  // mid-animation steps from there, not from the in-between angle.
  const rotationAnimTargetRef = useRef<number | null>(null);
  const cancelRotationAnim = useCallback(() => {
    if (rotationAnimRafRef.current) {
      cancelAnimationFrame(rotationAnimRafRef.current);
      rotationAnimRafRef.current = 0;
    }
    rotationAnimTargetRef.current = null;
  }, []);
  useEffect(() => cancelRotationAnim, [cancelRotationAnim]);
  // A reset / content load / restore that lands mid-animation wins: without
  // this the next frame would re-apply the stale target over it.
  useEffect(
    () =>
      viewTransformRef.current.subscribe((intent) => {
        if (intent === 'userReset' || intent === 'contentLoad' || intent === 'restore') {
          cancelRotationAnim();
        }
      }),
    [cancelRotationAnim, viewTransformRef],
  );

  /**
   * Animate the rotation to `target` about the screen pivot `(pivotX, pivotY)`
   * (rotated-frame screen coords of the drawing panel — see
   * `ViewTransform.setRotationAbout`).
   */
  const animateRotationTo = useCallback(
    (target: number, pivotX: number, pivotY: number) => {
      cancelRotationAnim();
      const vt = viewTransformRef.current;
      const from = vt.getRotation();
      const delta = shortestAngleDelta(from, target);
      const finish = () => {
        rotationAnimRafRef.current = 0;
        rotationAnimTargetRef.current = null;
        vt.setRotationAbout(
          target,
          pivotX,
          pivotY,
          containerSizeRef.current,
          getBaseScale(),
          'userRotate',
        );
        requestRedraw();
      };
      if (delta === 0) {
        finish();
        return;
      }
      rotationAnimTargetRef.current = target;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ROTATION_ANIM_MS);
        if (t >= 1) {
          finish();
          return;
        }
        const eased = 1 - (1 - t) ** 3;
        vt.setRotationAbout(
          from + delta * eased,
          pivotX,
          pivotY,
          containerSizeRef.current,
          getBaseScale(),
          'gesture',
        );
        requestRedraw();
        rotationAnimRafRef.current = requestAnimationFrame(step);
      };
      rotationAnimRafRef.current = requestAnimationFrame(step);
    },
    [cancelRotationAnim, getBaseScale, requestRedraw, viewTransformRef, containerSizeRef],
  );

  const isFlippedRef = useRef(isFlipped);
  useEffect(() => {
    isFlippedRef.current = isFlipped;
  });
  const animateRotationToRef = useRef(animateRotationTo);
  useEffect(() => {
    animateRotationToRef.current = animateRotationTo;
  });
  // Seeded with the mount-time seq so a remount (restore gate, panel swap)
  // doesn't replay a command that was already applied.
  const handledRotationSeqRef = useRef(rotationCommand?.seq ?? 0);
  useEffect(() => {
    if (!rotationCommand || rotationCommand.seq <= handledRotationSeqRef.current) return;
    handledRotationSeqRef.current = rotationCommand.seq;
    const container = containerSizeRef.current;
    const cx = container.width / 2;
    const cy = container.height / 2;
    if (rotationCommand.kind === 'reset') {
      animateRotationToRef.current(0, cx, cy);
      return;
    }
    const from = rotationAnimTargetRef.current ?? viewTransformRef.current.getRotation();
    const canvasDir = (isFlippedRef.current ? -rotationCommand.dir : rotationCommand.dir) as 1 | -1;
    animateRotationToRef.current(nextRotationStep(from, canvasDir), cx, cy);
  }, [rotationCommand, containerSizeRef, viewTransformRef]);

  return { cancelRotationAnim, animateRotationTo };
}
