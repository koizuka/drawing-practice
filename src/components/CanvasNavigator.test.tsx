import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasNavigator } from './CanvasNavigator';
import { ViewTransform } from '../drawing/ViewTransform';
import { StrokeManager } from '../drawing/StrokeManager';
import { t } from '../i18n';

const RECT = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0 };
const C = { width: 400, height: 300 };
const deg = (d: number) => (d * Math.PI) / 180;

let originalResizeObserver: typeof globalThis.ResizeObserver;

beforeEach(() => {
  vi.useFakeTimers();
  originalResizeObserver = globalThis.ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...RECT,
    toJSON: () => ({}),
  } as DOMRect);
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

function renderNavigator(vt: ViewTransform, isFlipped = false, showRotateButtons = false) {
  const onResetRotation = vi.fn();
  const onRotateStep = vi.fn();
  render(
    <CanvasNavigator
      viewTransform={vt}
      strokeManager={new StrokeManager()}
      isFlipped={isFlipped}
      contentVersion={0}
      onResetRotation={onResetRotation}
      showRotateButtons={showRotateButtons}
      onRotateStep={onRotateStep}
    />,
  );
  return { onResetRotation, onRotateStep };
}

describe('CanvasNavigator', () => {
  it('shows nothing while the camera is at home', () => {
    renderNavigator(new ViewTransform());
    expect(screen.queryByRole('button', { name: t('resetRotation') })).toBeNull();
    expect(screen.queryByTestId('canvas-navigator-map')).toBeNull();
  });

  it('shows the ▲ button while rotated; tapping it requests the upright reset', () => {
    const vt = new ViewTransform();
    vt.restoreCamera(0, 0, 1, deg(30));
    const { onResetRotation } = renderNavigator(vt);
    fireEvent.click(screen.getByRole('button', { name: t('resetRotation') }));
    expect(onResetRotation).toHaveBeenCalledTimes(1);
  });

  it('shows the overview with the angle during a gesture, then hides it', () => {
    const vt = new ViewTransform();
    renderNavigator(vt);
    act(() => {
      vt.applyGesture(200, 150, 1, 0, 0, C, 1, { rotated: true, rotationDelta: deg(-23) });
    });
    expect(screen.getByTestId('canvas-navigator-map')).toBeTruthy();
    expect(screen.getByText('-23°')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByTestId('canvas-navigator-map')).toBeNull();
    // Still off home → the ▲ stays.
    expect(screen.getByRole('button', { name: t('resetRotation') })).toBeTruthy();
  });

  it('a sub-degree tilt reads 0° but is not marked upright', () => {
    const vt = new ViewTransform();
    renderNavigator(vt);
    act(() => {
      vt.applyGesture(200, 150, 1, 0, 0, C, 1, { rotated: true, rotationDelta: deg(0.3) });
    });
    expect(screen.getByText('0°')).toBeTruthy();
    expect(screen.queryByText(new RegExp(t('viewUpright')))).toBeNull();
  });

  it('keeps the ▲ up while the disc lingers after a reset lands at home', () => {
    const vt = new ViewTransform();
    vt.restoreCamera(0, 0, 1, deg(30));
    renderNavigator(vt);
    act(() => {
      vt.setRotationAbout(0, 200, 150, C, 1, 'userRotate');
    });
    expect(vt.isDirty()).toBe(false);
    expect(screen.getByRole('button', { name: t('resetRotation') })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByRole('button', { name: t('resetRotation') })).toBeNull();
  });

  it('marks the upright state and the flip', () => {
    const vt = new ViewTransform();
    renderNavigator(vt, true);
    act(() => {
      vt.applyGesture(200, 150, 1, 30, 0, C, 1, { rotated: true });
    });
    expect(screen.getByText(new RegExp(`✓ ${t('viewUpright')}.*${t('viewFlipped')}`))).toBeTruthy();
  });

  describe('rotate step buttons', () => {
    it('are hidden unless enabled', () => {
      const vt = new ViewTransform();
      vt.restoreCamera(0, 0, 1, deg(30));
      renderNavigator(vt);
      expect(screen.queryByRole('button', { name: t('rotateViewLeft') })).toBeNull();
      expect(screen.queryByRole('button', { name: t('rotateViewRight') })).toBeNull();
    });

    it('show at home together with the ▲ when enabled, so rotation can start from 0°', () => {
      renderNavigator(new ViewTransform(), false, true);
      expect(screen.getByRole('button', { name: t('rotateViewLeft') })).toBeTruthy();
      expect(screen.getByRole('button', { name: t('rotateViewRight') })).toBeTruthy();
      expect(screen.getByRole('button', { name: t('resetRotation') })).toBeTruthy();
    });

    it('request one step in screen direction, like keys 4 / 6', () => {
      const { onRotateStep } = renderNavigator(new ViewTransform(), false, true);
      fireEvent.click(screen.getByRole('button', { name: t('rotateViewLeft') }));
      fireEvent.click(screen.getByRole('button', { name: t('rotateViewRight') }));
      expect(onRotateStep.mock.calls).toEqual([[-1], [1]]);
    });

    it('tapping the green ▲ at upright issues no reset', () => {
      const { onResetRotation } = renderNavigator(new ViewTransform(), false, true);
      fireEvent.click(screen.getByRole('button', { name: t('resetRotation') }));
      expect(onResetRotation).not.toHaveBeenCalled();
    });

    it('are in visual order in the DOM: ⟲, ⟳, ▲', () => {
      renderNavigator(new ViewTransform(), false, true);
      const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(names).toEqual([t('rotateViewLeft'), t('rotateViewRight'), t('resetRotation')]);
    });
  });
});
