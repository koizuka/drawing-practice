import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { GuideProvider } from '../guides/GuideContext';
import { useGuides } from '../guides/useGuides';
import { PerspectiveController } from './PerspectiveController';
import { t } from '../i18n';

/** Enters perspective mode and exposes the live guide state for assertions. */
function Probe() {
  const { grid, setGridMode, lastChangeTransient, placingCenter } = useGuides();
  useEffect(() => {
    setGridMode('perspective');
  }, [setGridMode]);
  return (
    <div
      data-testid="probe"
      data-yaw={grid.perspective?.yaw}
      data-pitch={grid.perspective?.pitch}
      data-strength={grid.perspective?.strength}
      data-transient={String(lastChangeTransient)}
      data-placing={String(placingCenter)}
    >
      <button type="button" data-testid="to-normal-grid" onClick={() => setGridMode('normal')} />
    </div>
  );
}

function renderController() {
  return render(
    <GuideProvider>
      <Probe />
      <PerspectiveController />
    </GuideProvider>,
  );
}

function padElement(): HTMLElement {
  const pad = screen.getByLabelText(t('perspectiveRotation'));
  // jsdom reports a zero-size rect; give the pad its real geometry.
  pad.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 96, height: 96, right: 96, bottom: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return pad;
}

beforeEach(() => {
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe('PerspectiveController', () => {
  it('commits yaw/pitch from a pad drag on pointer up (non-transient)', () => {
    renderController();
    const pad = padElement();

    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });

    const probe = screen.getByTestId('probe');
    expect(Number(probe.dataset.yaw)).toBe(90);
    expect(Number(probe.dataset.pitch)).toBe(0);
    expect(probe.dataset.transient).toBe('false');
  });

  it('reports transient updates during the drag', async () => {
    renderController();
    const pad = padElement();

    fireEvent.pointerDown(pad, { clientX: 48, clientY: 96, pointerId: 1 });
    // Let the rAF-throttled flush run.
    await act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));

    const probe = screen.getByTestId('probe');
    expect(Number(probe.dataset.pitch)).toBe(90);
    expect(probe.dataset.transient).toBe('true');
  });

  it('maps the pad center to the neutral pose', () => {
    renderController();
    const pad = padElement();

    fireEvent.pointerDown(pad, { clientX: 96, clientY: 96, pointerId: 1 });
    fireEvent.pointerMove(pad, { clientX: 48, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });

    const probe = screen.getByTestId('probe');
    expect(Number(probe.dataset.yaw)).toBe(0);
    expect(Number(probe.dataset.pitch)).toBe(0);
  });

  it('toggles the place-anchor mode', () => {
    renderController();

    fireEvent.click(screen.getByRole('button', { name: t('perspectivePlaceCenter') }));
    expect(screen.getByTestId('probe').dataset.placing).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: t('perspectivePlaceCenter') }));
    expect(screen.getByTestId('probe').dataset.placing).toBe('false');
  });

  it('disarms the place-anchor mode when leaving perspective mode', () => {
    renderController();

    fireEvent.click(screen.getByRole('button', { name: t('perspectivePlaceCenter') }));
    expect(screen.getByTestId('probe').dataset.placing).toBe('true');

    fireEvent.click(screen.getByTestId('to-normal-grid'));
    expect(screen.getByTestId('probe').dataset.placing).toBe('false');
  });

  it('resets all perspective settings to defaults', () => {
    renderController();
    const pad = padElement();

    // Move away from the neutral pose first.
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 96, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(Number(screen.getByTestId('probe').dataset.yaw)).toBe(90);

    fireEvent.click(screen.getByRole('button', { name: t('perspectiveReset') }));

    const probe = screen.getByTestId('probe');
    expect(Number(probe.dataset.yaw)).toBe(0);
    expect(Number(probe.dataset.pitch)).toBe(0);
    expect(Number(probe.dataset.strength)).toBe(0.5);
    expect(probe.dataset.transient).toBe('false');
  });

  it('collapses to a single expand button and back', () => {
    renderController();

    fireEvent.click(screen.getByRole('button', { name: t('collapsePerspectiveController') }));
    expect(screen.queryByLabelText(t('perspectiveRotation'))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('expandPerspectiveController') }));
    expect(screen.getByLabelText(t('perspectiveRotation'))).toBeInTheDocument();
  });
});
