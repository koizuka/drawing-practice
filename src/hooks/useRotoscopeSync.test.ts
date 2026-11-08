import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useRotoscopeSync } from './useRotoscopeSync';
import { StrokeManager } from '../drawing/StrokeManager';
import { VideoSyncBridge, type VideoPlayerControl } from '../utils/videoSyncBridge';

function setup(currentTime: number | null = 12) {
  const sm = new StrokeManager();
  sm.addFrame(); // two frames; current = frame index 1
  const bridge = new VideoSyncBridge();
  const control: VideoPlayerControl = {
    seekTo: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    getCurrentTime: vi.fn(() => currentTime),
  };
  bridge.attach(control);
  const stopPlayback = vi.fn();
  const onSyncChanged = vi.fn();
  const props = {
    strokeManager: sm,
    youtubeVideoId: 'vid' as string | null,
    videoBridge: bridge,
    playing: false,
    shownIndex: sm.getCurrentFrameIndex(),
    stopPlayback,
    onSyncChanged,
  };
  return { sm, bridge, control, stopPlayback, onSyncChanged, props };
}

describe('useRotoscopeSync', () => {
  it('returns undefined for a non-YouTube reference', () => {
    const { props } = setup();
    const { result } = renderHook(() => useRotoscopeSync({ ...props, youtubeVideoId: null }));
    expect(result.current).toBeUndefined();
  });

  it('anchors the current frame to the current video time on toggle', () => {
    const { sm, control, stopPlayback, onSyncChanged, props } = setup(12);
    const { result, rerender } = renderHook((p) => useRotoscopeSync(p), { initialProps: props });
    expect(result.current?.active).toBe(false);
    expect(result.current?.canEnable).toBe(true);

    act(() => result.current!.onToggle());
    expect(stopPlayback).toHaveBeenCalled();
    expect(onSyncChanged).toHaveBeenCalled();
    const sync = sm.getVideoSync()!;
    expect(sync.videoId).toBe('vid');
    // Frame index 1 sits at 12s.
    expect(sync.offset + 1 * sync.step).toBeCloseTo(12);

    rerender({ ...props });
    expect(result.current?.active).toBe(true);
    expect(result.current?.time).toBeCloseTo(12);
    // Editing (not playing): the player is parked on the current frame.
    expect(control.seekTo).toHaveBeenLastCalledWith(expect.closeTo(12), { play: false });
  });

  it('refuses to anchor before the player has reported a time', () => {
    const { sm, onSyncChanged, props } = setup(null);
    const { result } = renderHook(() => useRotoscopeSync(props));
    expect(result.current?.canEnable).toBe(false);
    act(() => result.current!.onToggle());
    expect(sm.getVideoSync()).toBeUndefined();
    expect(onSyncChanged).not.toHaveBeenCalled();
  });

  it('turning sync off clears it and pauses the video', () => {
    const { sm, control, props } = setup(12);
    sm.setVideoSync({ videoId: 'vid', offset: 0, step: 0.5 });
    const { result } = renderHook(() => useRotoscopeSync(props));
    expect(result.current?.active).toBe(true);
    act(() => result.current!.onToggle());
    expect(sm.getVideoSync()).toBeUndefined();
    expect(control.pause).toHaveBeenCalled();
  });

  it('is inactive when the sync names a different video', () => {
    const { sm, control, props } = setup(12);
    sm.setVideoSync({ videoId: 'other', offset: 0, step: 0.5 });
    const { result } = renderHook(() => useRotoscopeSync(props));
    expect(result.current?.active).toBe(false);
    expect(control.seekTo).not.toHaveBeenCalled();
  });

  it('seeks paused per frame during non-realtime playback', () => {
    const { sm, control, props } = setup(12);
    // step 0.5s at the default fps is not realtime → seek every shown frame.
    sm.setVideoSync({ videoId: 'vid', offset: 10, step: 0.5 });
    const { rerender } = renderHook((p) => useRotoscopeSync(p), {
      initialProps: { ...props, playing: true, shownIndex: 0 },
    });
    expect(control.seekTo).toHaveBeenLastCalledWith(10, { play: false });
    rerender({ ...props, playing: true, shownIndex: 1 });
    expect(control.seekTo).toHaveBeenLastCalledWith(10.5, { play: false });
  });

  it('re-aligns immediately when playback switches between realtime and per-frame seeking', () => {
    const { sm, control, props } = setup(12);
    // step 1/8 s at the default 8 fps = one frame per tick → realtime: the video runs.
    sm.setVideoSync({ videoId: 'vid', offset: 10, step: 0.125 });
    const playing = { ...props, playing: true, shownIndex: 1 };
    const { rerender } = renderHook((p) => useRotoscopeSync(p), { initialProps: playing });
    expect(control.seekTo).toHaveBeenLastCalledWith(10.125, { play: true });

    // fps change mid-playback → no longer realtime: seek paused right away,
    // without waiting for the next frame / loop wrap.
    vi.mocked(control.seekTo).mockClear();
    sm.setFps(12);
    rerender({ ...playing });
    expect(control.seekTo).toHaveBeenCalledTimes(1);
    expect(control.seekTo).toHaveBeenLastCalledWith(10.125, { play: false });

    // Back to realtime → seek and let it play again.
    vi.mocked(control.seekTo).mockClear();
    sm.setFps(8);
    rerender({ ...playing });
    expect(control.seekTo).toHaveBeenCalledTimes(1);
    expect(control.seekTo).toHaveBeenLastCalledWith(10.125, { play: true });
  });
});
