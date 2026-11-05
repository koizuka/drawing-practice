import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { useReducer } from 'react';
import { LayerPopoverButton } from './LayerPopoverButton';
import { StrokeManager } from '../drawing/StrokeManager';

function Harness({
  manager,
  onChanged,
}: {
  manager: StrokeManager;
  onChanged: (opts?: { flush?: boolean }) => void;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  return (
    <LayerPopoverButton
      strokeManager={manager}
      onChanged={(opts) => {
        onChanged(opts);
        bump();
      }}
    />
  );
}

function draw(m: StrokeManager) {
  m.startStroke({ x: 0, y: 0 });
  m.appendStroke({ x: 10, y: 10 });
  m.endStroke();
}

describe('LayerPopoverButton', () => {
  it('selects a layer with a focusable row button', () => {
    const m = new StrokeManager();
    m.addLayer();
    render(<Harness manager={m} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer: Layer 1' }));
    expect(m.getActiveLayerId()).toBe('base');
  });

  it('applies the draft + ink preset', () => {
    const m = new StrokeManager();
    draw(m);
    const onChanged = vi.fn();
    render(<Harness manager={m} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft + Ink' }));
    const layers = m.getLayers();
    expect(layers.map((l) => l.name)).toEqual(['Draft', 'Ink']);
    expect(layers[0]).toMatchObject({ color: 'blue', opacity: 0.5 });
    // Already drew → start inking.
    expect(m.getActiveLayerId()).toBe(layers[1].id);
    expect(onChanged).toHaveBeenCalledWith({ flush: true });
  });

  it('toggles visibility and asks before deleting a non-empty layer', () => {
    const m = new StrokeManager();
    m.addLayer();
    draw(m);
    render(<Harness manager={m} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Hide layer' }));
    expect(m.getLayers()[0].visible).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete layer' }));
    expect(m.getLayers()).toHaveLength(2); // confirm pending
    // In-place confirm: the ✓ replaces the trash button and carries its label.
    fireEvent.click(screen.getByRole('button', { name: 'Delete layer' }));
    expect(m.getLayers()).toHaveLength(1);
    expect(m.getStrokes()).toHaveLength(0);
  });
});
