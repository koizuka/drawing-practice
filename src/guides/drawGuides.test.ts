import { describe, expect, it, vi } from 'vitest';
import { drawMasks } from './drawGuides';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D & {
    fillRect: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
    setLineDash: ReturnType<typeof vi.fn>;
  };
}

const masks = [
  { id: 'mask-1', x: 0, y: 0, w: 10, h: 20 },
  { id: 'mask-2', x: 30, y: 30, w: 5, h: 5 },
];

describe('drawMasks', () => {
  it('fills every mask when hidden', () => {
    const ctx = mockCtx();
    drawMasks(ctx, masks, true, 2);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 20);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
  });

  it('draws only a dashed outline when revealed', () => {
    const ctx = mockCtx();
    drawMasks(ctx, masks, false, 2);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    expect(ctx.setLineDash).toHaveBeenCalledWith([3, 2]);
  });

  it('draws nothing for an empty list', () => {
    const ctx = mockCtx();
    drawMasks(ctx, [], true, 1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});
