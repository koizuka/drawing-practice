import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { useReducer } from 'react';
import { AnimationTimeline } from './AnimationTimeline';
import { StrokeManager } from '../drawing/StrokeManager';

function draw(m: StrokeManager, x: number) {
  m.startStroke({ x, y: 0 });
  m.appendStroke({ x: x + 10, y: 10 });
  m.endStroke();
}

function Harness({
  m,
  onSelect,
  videoSync,
  playing = false,
}: {
  m: StrokeManager;
  onSelect?: (id: string) => void;
  playing?: boolean;
  videoSync?: { active: boolean; time: number | null; onToggle: () => void };
}) {
  const [v, bump] = useReducer((n: number) => n + 1, 0);
  return (
    <AnimationTimeline
      strokeManager={m}
      contentVersion={v}
      playing={playing}
      displayIndex={m.getCurrentFrameIndex()}
      onTogglePlay={() => {}}
      onSelectFrame={(id) => {
        m.setCurrentFrame(id);
        onSelect?.(id);
        bump();
      }}
      onChanged={bump}
      onionRange={1}
      onOnionRangeChange={() => {}}
      videoSync={videoSync}
    />
  );
}

describe('AnimationTimeline', () => {
  it('adds, duplicates and selects frames', () => {
    const m = new StrokeManager();
    draw(m, 0);
    const onSelect = vi.fn();
    render(<Harness m={m} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate frame' }));
    fireEvent.click(screen.getByRole('button', { name: 'New frame' }));
    expect(m.getFrames()).toHaveLength(3);
    expect(m.getStrokes()).toHaveLength(2);
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Frame 1' }));
    expect(onSelect).toHaveBeenCalledWith(m.getFrames()[0]);
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled();
  });

  it('asks before deleting a non-empty frame', () => {
    const m = new StrokeManager();
    m.addFrame();
    draw(m, 0);
    render(<Harness m={m} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete frame' }));
    expect(m.getFrames()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete frame' }));
    expect(m.getFrames()).toHaveLength(1);
    expect(m.getStrokes()).toHaveLength(0);
  });

  it('changes fps', () => {
    const m = new StrokeManager();
    render(<Harness m={m} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Playback speed' }));
    fireEvent.click(screen.getByRole('option', { name: '12 fps' }));
    expect(m.getFps()).toBe(12);
  });
});

describe('AnimationTimeline rotoscope toggle', () => {
  it('is hidden without a video reference', () => {
    render(<Harness m={new StrokeManager()} />);
    expect(screen.queryByRole('button', { name: /video/i })).toBeNull();
  });

  it('toggles and shows the frame time while synced', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <Harness m={new StrokeManager()} videoSync={{ active: false, time: null, onToggle }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sync frames to the video/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Video time of this frame')).toBeNull();
    rerender(
      <Harness m={new StrokeManager()} videoSync={{ active: true, time: 61.5, onToggle }} />,
    );
    expect(screen.getByRole('button', { name: 'Stop syncing frames to the video' })).toBeTruthy();
    expect(screen.getByLabelText('Video time of this frame').textContent).toBe('1:01.50');
  });
});

describe('AnimationTimeline select mode (bulk delete)', () => {
  function setup(n = 5) {
    const m = new StrokeManager();
    for (let i = 0; i < n; i++) {
      if (i > 0) m.addFrame({ atEnd: true });
      m.setCurrentFrame(m.getFrames()[i]);
      draw(m, i * 10);
    }
    m.setCurrentFrame(m.getFrames()[0]);
    const onSelect = vi.fn();
    const utils = render(<Harness m={m} onSelect={onSelect} />);
    const cell = (i: number) => screen.getByRole('button', { name: `Frame ${i + 1}` });
    return { m, onSelect, cell, ...utils };
  }

  it('taps toggle selection without navigating, then deletes as one undo', () => {
    const { m, onSelect, cell } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Select frames/ }));
    fireEvent.pointerDown(cell(1), { pointerType: 'touch' });
    fireEvent.pointerUp(cell(1));
    fireEvent.pointerDown(cell(3), { pointerType: 'touch' });
    fireEvent.pointerUp(cell(3));
    fireEvent.click(cell(3), { detail: 1 }); // the pointer click after a tap: no navigate, no re-toggle
    expect(onSelect).not.toHaveBeenCalled();
    expect(cell(1)).toHaveAttribute('aria-pressed', 'true');
    expect(cell(2)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('2 selected')).toBeTruthy();
    // Keyboard activation (detail 0) toggles.
    fireEvent.click(cell(4));
    expect(cell(4)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cell(4));

    const before = m.getFrames().slice();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected frames' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected frames' })); // ✓
    expect(m.getFrames()).toEqual([before[0], before[2], before[4]]);
    // Back to normal mode.
    expect(screen.getByRole('button', { name: /Select frames/ })).toBeTruthy();
    m.undo();
    expect(m.getFrames()).toEqual(before);
  });

  it('drag paints a range; select-all cannot delete every frame', () => {
    const { cell } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Select frames/ }));
    const strip = screen.getByRole('group', { name: 'Frames' });
    const original = document.elementFromPoint;
    document.elementFromPoint = ((x: number) => cell(x)) as typeof document.elementFromPoint;
    try {
      fireEvent.pointerDown(cell(1), { pointerType: 'touch', clientX: 1 });
      fireEvent.pointerMove(strip, { clientX: 3, clientY: 0 });
      fireEvent.pointerUp(strip);
    } finally {
      document.elementFromPoint = original;
    }
    expect([0, 1, 2, 3, 4].map((i) => cell(i).getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'false',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'At least one frame must remain' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: 'Delete selected frames' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Done selecting' }));
    expect(screen.getByRole('button', { name: /Select frames/ })).toBeTruthy();
  });
});

describe('AnimationTimeline select mode extras', () => {
  function setup() {
    const m = new StrokeManager();
    for (let i = 0; i < 5; i++) {
      if (i > 0) m.addFrame({ atEnd: true });
      m.setCurrentFrame(m.getFrames()[i]);
      draw(m, i * 10);
    }
    const utils = render(<Harness m={m} />);
    const cell = (i: number) => screen.getByRole('button', { name: `Frame ${i + 1}` });
    fireEvent.click(screen.getByRole('button', { name: /Select frames/ }));
    return { m, cell, ...utils };
  }

  it('shift-click extends from the last anchor', () => {
    const { cell } = setup();
    fireEvent.pointerDown(cell(1), { pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(cell(1));
    fireEvent.pointerDown(cell(3), { pointerType: 'mouse', button: 0, shiftKey: true });
    fireEvent.pointerUp(cell(3));
    expect([0, 1, 2, 3, 4].map((i) => cell(i).getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'false',
    ]);
  });

  it('starting playback leaves select mode', () => {
    const { m, rerender } = setup();
    expect(screen.getByRole('button', { name: 'Done selecting' })).toBeTruthy();
    rerender(<Harness m={m} playing />);
    expect(screen.queryByRole('button', { name: 'Done selecting' })).toBeNull();
  });
});
