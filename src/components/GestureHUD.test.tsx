import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { GestureHUD, type GestureHUDProps } from './GestureHUD';

function makeProps(overrides: Partial<GestureHUDProps> = {}): GestureHUDProps {
  return {
    active: true,
    paused: false,
    loadingMore: false,
    durationMs: 30_000,
    remainingMs: 30_000,
    completedCount: 0,
    currentIndex: 1,
    queueRemaining: 5,
    hasMoreInBackend: false,
    onSkip: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
}

describe('GestureHUD', () => {
  it('renders nothing when active is false', () => {
    const { container } = render(<GestureHUD {...makeProps({ active: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the rounded-up countdown seconds', () => {
    render(<GestureHUD {...makeProps({ remainingMs: 12_300 })} />);
    // Math.ceil(12300/1000) = 13
    expect(screen.getByText('13')).toBeInTheDocument();
  });

  it('shows 30 at the very start of a 30s pose (rounding up, not down)', () => {
    render(<GestureHUD {...makeProps({ durationMs: 30_000, remainingMs: 30_000 })} />);
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows the current pose index, completed count, and queued count', () => {
    render(<GestureHUD {...makeProps({ currentIndex: 3, completedCount: 2, queueRemaining: 7 })} />);
    expect(screen.getByText(/Pose 3 \(2 ✓\)/)).toBeInTheDocument();
    // Plain count when no more pages on backend.
    expect(screen.getByText(/queued 7/)).toBeInTheDocument();
  });

  it('appends "+" to queued count when more pages are available', () => {
    render(<GestureHUD {...makeProps({ queueRemaining: 5, hasMoreInBackend: true })} />);
    expect(screen.getByText(/queued 5\+/)).toBeInTheDocument();
  });

  it('shows the loading-more hint when loadingMore is true', () => {
    render(<GestureHUD {...makeProps({ loadingMore: true })} />);
    expect(screen.getByText(/Loading more/i)).toBeInTheDocument();
  });

  it('renders the Pause button when running, calls onPause when clicked', () => {
    const onPause = vi.fn();
    render(<GestureHUD {...makeProps({ paused: false, onPause })} />);
    const btn = screen.getByLabelText('Pause');
    fireEvent.click(btn);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('renders the Resume button when paused, calls onResume when clicked', () => {
    const onResume = vi.fn();
    render(<GestureHUD {...makeProps({ paused: true, onResume })} />);
    expect(screen.queryByLabelText('Pause')).not.toBeInTheDocument();
    const btn = screen.getByLabelText('Resume');
    fireEvent.click(btn);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('Skip button calls onSkip', () => {
    const onSkip = vi.fn();
    render(<GestureHUD {...makeProps({ onSkip })} />);
    fireEvent.click(screen.getByLabelText('Skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Exit button calls onExit', () => {
    const onExit = vi.fn();
    render(<GestureHUD {...makeProps({ onExit })} />);
    fireEvent.click(screen.getByLabelText('Exit session'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
