import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { GuideProvider } from '../guides/GuideContext';
import { useGuides } from '../guides/useGuides';
import { PerspectiveController } from './PerspectiveController';
import { t } from '../i18n';

/** Enters perspective mode and exposes the live guide state for assertions. */
function Probe() {
  const { grid, setGridMode, lastChangeTransient, placingCenter, recordPerspectiveMemory } = useGuides();
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
      <button type="button" data-testid="record-memory" onClick={recordPerspectiveMemory} />
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

  it('shows no memory buttons until a memory is recorded', () => {
    renderController();
    expect(screen.queryByTestId('perspective-memory-1')).toBeNull();
    expect(screen.queryByTestId('perspective-memory-delete')).toBeNull();
  });

  it('recalls a memorized angle from its button', () => {
    renderController();
    const pad = padElement();

    // Memorize the neutral pose, then move away and memorize the new angle.
    fireEvent.click(screen.getByTestId('record-memory'));
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    fireEvent.click(screen.getByTestId('record-memory'));

    expect(screen.getByTestId('perspective-memory-2')).toBeInTheDocument();
    expect(Number(screen.getByTestId('probe').dataset.yaw)).toBe(90);

    fireEvent.click(screen.getByTestId('perspective-memory-1'));

    const probe = screen.getByTestId('probe');
    expect(Number(probe.dataset.yaw)).toBe(0);
    expect(Number(probe.dataset.pitch)).toBe(0);
    // Recall is a discrete button action — must flush, not debounce.
    expect(probe.dataset.transient).toBe('false');
  });

  it('does not duplicate a memory for the same angle', () => {
    renderController();

    fireEvent.click(screen.getByTestId('record-memory'));
    fireEvent.click(screen.getByTestId('record-memory'));

    expect(screen.getByTestId('perspective-memory-1')).toBeInTheDocument();
    expect(screen.queryByTestId('perspective-memory-2')).toBeNull();
  });

  it('disables the trash button while no memory matches the current angle', () => {
    renderController();
    const pad = padElement();

    fireEvent.click(screen.getByTestId('record-memory'));
    expect(screen.getByTestId('perspective-memory-delete')).toBeEnabled();

    // Rotate away from the memorized angle — nothing is selected to delete.
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(screen.getByTestId('perspective-memory-delete')).toBeDisabled();

    // Recalling a memory re-enables it.
    fireEvent.click(screen.getByTestId('perspective-memory-1'));
    expect(screen.getByTestId('perspective-memory-delete')).toBeEnabled();
  });

  it('deletes the selected memory after the in-place confirmation', () => {
    renderController();
    const pad = padElement();

    fireEvent.click(screen.getByTestId('record-memory'));
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    fireEvent.click(screen.getByTestId('record-memory'));

    // Select memory 1 and delete it via trash → ✓.
    fireEvent.click(screen.getByTestId('perspective-memory-1'));
    fireEvent.click(screen.getByTestId('perspective-memory-delete'));
    fireEvent.click(screen.getByTestId('perspective-memory-delete-confirm'));

    // Memory 1 is gone, memory 2 keeps its label.
    expect(screen.queryByTestId('perspective-memory-1')).toBeNull();
    expect(screen.getByTestId('perspective-memory-2')).toBeInTheDocument();
  });

  it('keeps the memory when the confirmation is cancelled', () => {
    renderController();

    fireEvent.click(screen.getByTestId('record-memory'));
    fireEvent.click(screen.getByTestId('perspective-memory-delete'));
    // While confirming, the target's button is hidden (the ✓/✗ pair takes its
    // slot so the grid never exceeds 5×2, and the gap previews the deletion).
    expect(screen.queryByTestId('perspective-memory-1')).toBeNull();

    fireEvent.click(screen.getByTestId('perspective-memory-delete-cancel'));

    expect(screen.getByTestId('perspective-memory-1')).toBeInTheDocument();
    expect(screen.getByTestId('perspective-memory-delete')).toBeInTheDocument();
  });

  it('does not resurrect a dropped confirmation when the same memory is recalled again', () => {
    renderController();
    const pad = padElement();

    fireEvent.click(screen.getByTestId('record-memory'));

    // Arm deletion, rotate away (deselects), then recall the same memory —
    // the earlier confirmation must not reappear out of nowhere.
    fireEvent.click(screen.getByTestId('perspective-memory-delete'));
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    fireEvent.click(screen.getByTestId('perspective-memory-1'));

    expect(screen.queryByTestId('perspective-memory-delete-confirm')).toBeNull();
    expect(screen.getByTestId('perspective-memory-delete')).toBeEnabled();
  });

  it('drops a pending delete confirmation when another memory is recalled', () => {
    renderController();
    const pad = padElement();

    fireEvent.click(screen.getByTestId('record-memory'));
    fireEvent.pointerDown(pad, { clientX: 96, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    fireEvent.click(screen.getByTestId('record-memory'));

    // Arm deletion of memory 2 (currently active), then recall memory 1 —
    // the confirmation must vanish instead of silently retargeting.
    fireEvent.click(screen.getByTestId('perspective-memory-delete'));
    fireEvent.click(screen.getByTestId('perspective-memory-1'));
    expect(screen.queryByTestId('perspective-memory-delete-confirm')).toBeNull();
    expect(screen.getByTestId('perspective-memory-delete')).toBeInTheDocument();
  });

  it('collapses to a single expand button and back', () => {
    renderController();

    fireEvent.click(screen.getByRole('button', { name: t('collapsePerspectiveController') }));
    expect(screen.queryByLabelText(t('perspectiveRotation'))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('expandPerspectiveController') }));
    expect(screen.getByLabelText(t('perspectiveRotation'))).toBeInTheDocument();
  });
});
