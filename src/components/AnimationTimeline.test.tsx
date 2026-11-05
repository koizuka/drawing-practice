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

function Harness({ m, onSelect }: { m: StrokeManager; onSelect?: (id: string) => void }) {
  const [v, bump] = useReducer((n: number) => n + 1, 0);
  return (
    <AnimationTimeline
      strokeManager={m}
      contentVersion={v}
      playing={false}
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
