import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { YouTubeViewer, type YouTubePlayerHandle } from './YouTubeViewer';
import { ViewTransform } from '../drawing/ViewTransform';
import type { GridSettings } from '../guides/types';

const grid: GridSettings = { mode: 'none' };

const baseProps = {
  videoId: 'dQw4w9WgXcQ',
  grid,
  guideLines: [] as const,
  guideVersion: 0,
  guideMode: 'none' as const,
};

function touch(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY } as Touch;
}

const CANVAS_RECT: DOMRect = {
  left: 10,
  top: 20,
  right: 410,
  bottom: 320,
  width: 400,
  height: 300,
  x: 10,
  y: 20,
  toJSON: () => ({}),
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('YouTubeViewer wheel zoom', () => {
  it('applies pinch-scale on ctrlKey wheel (trackpad pinch)', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.wheel(canvas, { clientX: 110, clientY: 100, deltaY: -50, ctrlKey: true });

    expect(applyGesture).toHaveBeenCalledTimes(1);
    const [focalX, focalY, scaleDelta, translateX, translateY] = applyGesture.mock.calls[0];
    expect(focalX).toBeCloseTo(100); // 110 - rect.left=10
    expect(focalY).toBeCloseTo(80); // 100 - rect.top=20
    expect(scaleDelta).toBeGreaterThan(1); // deltaY<0 → zoom in
    expect(translateX).toBe(0);
    expect(translateY).toBe(0);
  });

  it('applies translate on wheel without ctrlKey (panning)', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.wheel(canvas, { clientX: 110, clientY: 100, deltaX: 20, deltaY: 30 });

    expect(applyGesture).toHaveBeenCalledTimes(1);
    const [, , scaleDelta, translateX, translateY] = applyGesture.mock.calls[0];
    expect(scaleDelta).toBe(1);
    expect(translateX).toBe(-20);
    expect(translateY).toBe(-30);
  });

  it('skips wheel zoom when in guideMode', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} guideMode="add" viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.wheel(canvas, { clientX: 110, clientY: 100, deltaY: -50, ctrlKey: true });

    expect(applyGesture).not.toHaveBeenCalled();
  });

  it('skips wheel zoom when videoInteractMode=true', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(
      <YouTubeViewer {...baseProps} viewTransform={vt} videoInteractMode />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.wheel(canvas, { clientX: 110, clientY: 100, deltaY: -50, ctrlKey: true });

    expect(applyGesture).not.toHaveBeenCalled();
  });
});

describe('YouTubeViewer pinch gesture', () => {
  it('applies pinch on 2-finger touchMove', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });

    expect(applyGesture).toHaveBeenCalledTimes(1);
  });

  it('does not apply pinch on single-finger touchMove', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 150, 150)] });

    expect(applyGesture).not.toHaveBeenCalled();
  });

  it('stops pinching when one finger lifts', () => {
    const vt = new ViewTransform();
    const applyGesture = vi.spyOn(vt, 'applyGesture');
    const { container } = render(<YouTubeViewer {...baseProps} viewTransform={vt} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });
    expect(applyGesture).toHaveBeenCalledTimes(1);

    fireEvent.touchEnd(canvas, { changedTouches: [touch(1, 220, 220)] });
    applyGesture.mockClear();

    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 50, 50)] });
    expect(applyGesture).not.toHaveBeenCalled();
  });
});

describe('YouTubeViewer tap → video interact', () => {
  it('calls onRequestVideoInteract on a single short mouse click', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });

    expect(onRequestVideoInteract).toHaveBeenCalledTimes(1);
  });

  it('calls onRequestVideoInteract on a single short touch tap', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100)] });
    fireEvent.touchEnd(canvas, { changedTouches: [touch(0, 100, 100)] });

    expect(onRequestVideoInteract).toHaveBeenCalledTimes(1);
  });

  it('does not call onRequestVideoInteract when movement exceeds the tap threshold (drag)', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 140 });
    fireEvent.mouseUp(canvas, { clientX: 140, clientY: 140 });

    expect(onRequestVideoInteract).not.toHaveBeenCalled();
  });

  it('does not call onRequestVideoInteract after a 2-finger pinch release', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} viewTransform={new ViewTransform()} onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.touchStart(canvas, { changedTouches: [touch(0, 100, 100), touch(1, 200, 200)] });
    fireEvent.touchMove(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });
    fireEvent.touchEnd(canvas, { changedTouches: [touch(0, 80, 80), touch(1, 220, 220)] });

    expect(onRequestVideoInteract).not.toHaveBeenCalled();
  });

  it('does not call onRequestVideoInteract in guideMode', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} guideMode="add" onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });

    expect(onRequestVideoInteract).not.toHaveBeenCalled();
  });

  it('does not call onRequestVideoInteract for slow taps exceeding the duration threshold', () => {
    const onRequestVideoInteract = vi.fn();
    const baseTime = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const { container } = render(
      <YouTubeViewer {...baseProps} onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    nowSpy.mockReturnValue(baseTime + 500);
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });

    expect(onRequestVideoInteract).not.toHaveBeenCalled();
  });
});

describe('YouTubeViewer videoInteractMode', () => {
  it('detaches mouse/touch handlers when videoInteractMode=true so tap does not fire onRequestVideoInteract', () => {
    const onRequestVideoInteract = vi.fn();
    const { container } = render(
      <YouTubeViewer {...baseProps} videoInteractMode onRequestVideoInteract={onRequestVideoInteract} />,
    );
    const canvas = container.querySelector('canvas')!;

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });

    expect(onRequestVideoInteract).not.toHaveBeenCalled();
  });

  it('sets pointer-events:none on canvas when videoInteractMode=true', () => {
    const { container } = render(
      <YouTubeViewer {...baseProps} videoInteractMode />,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.style.touchAction).toBe('auto');
  });

  it('sets pointer-events:auto + touch-action:none by default (zoom mode)', () => {
    const { container } = render(<YouTubeViewer {...baseProps} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.style.pointerEvents).toBe('auto');
    expect(canvas.style.touchAction).toBe('none');
  });
});

describe('YouTubeViewer IFrame API handle', () => {
  it('exposes play() that posts a playVideo command to the iframe', () => {
    const handleRef = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubeViewer {...baseProps} ref={handleRef} />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    // jsdom iframes have a real contentWindow; spy on its postMessage.
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      handleRef.current?.play();
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin] = postMessage.mock.calls[0];
    expect(targetOrigin).toBe('https://www.youtube.com');
    expect(JSON.parse(msg)).toMatchObject({ event: 'command', func: 'playVideo' });
  });

  it('exposes pause() that posts a pauseVideo command', () => {
    const handleRef = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubeViewer {...baseProps} ref={handleRef} />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      handleRef.current?.pause();
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({ event: 'command', func: 'pauseVideo' });
  });
});
