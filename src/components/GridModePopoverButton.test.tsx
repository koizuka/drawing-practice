import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GridModePopoverButton } from './GridModePopoverButton';
import { t } from '../i18n';

function openPopover() {
  fireEvent.click(screen.getAllByRole('button')[0]);
}

describe('GridModePopoverButton', () => {
  it('opens the popover and reports the selected mode', () => {
    const onSetGridMode = vi.fn();
    render(<GridModePopoverButton grid={{ mode: 'none' }} onSetGridMode={onSetGridMode} />);

    openPopover();
    fireEvent.click(screen.getByRole('button', { name: t('gridModePerspective') }));

    expect(onSetGridMode).toHaveBeenCalledWith('perspective');
  });

  it('closes the popover after a selection', () => {
    render(<GridModePopoverButton grid={{ mode: 'none' }} onSetGridMode={() => {}} />);

    openPopover();
    fireEvent.click(screen.getByRole('button', { name: t('gridModeNormal') }));

    expect(screen.queryByRole('button', { name: t('gridModeLarge') })).toBeNull();
  });

  it('marks the current mode as selected', () => {
    render(<GridModePopoverButton grid={{ mode: 'large' }} onSetGridMode={() => {}} />);

    openPopover();
    expect(screen.getByRole('button', { name: t('gridModeLarge') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: t('gridModeNone') })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('does not fire when the same mode is re-selected', () => {
    const onSetGridMode = vi.fn();
    render(<GridModePopoverButton grid={{ mode: 'normal' }} onSetGridMode={onSetGridMode} />);

    openPopover();
    fireEvent.click(screen.getByRole('button', { name: t('gridModeNormal') }));

    // ToggleButtonGroup exclusive reports null when the active value is
    // clicked again — the mode must stay unchanged.
    expect(onSetGridMode).not.toHaveBeenCalled();
  });
});
