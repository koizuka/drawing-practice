import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrokeManager } from '../drawing/StrokeManager';
import { loadPref, savePref } from '../utils/prefs';

// Animation timeline visibility + onion-skin range are per-user view
// preferences (like pinch-rotate), not part of the drawing — localStorage.
const TIMELINE_OPEN_STORAGE_KEY = 'drawing.timelineOpen';
const ONION_RANGE_STORAGE_KEY = 'drawing.onionRange';

interface UseAnimationPlaybackOptions {
  strokeManager: StrokeManager;
  /** Bump the panel's redraw version (re-render + canvas redraw). */
  requestRedraw: () => void;
  /** Forwarded to the parent's autosave (`{ flush: true }` = save now). */
  onStrokesChanged?: (opts?: { flush?: boolean }) => void;
  /** Drop the erase-mode stroke highlight (it may point at another frame). */
  clearHighlight: () => void;
}

/**
 * Animation timeline state: open/closed, onion-skin range, and playback.
 *
 * Playback renders `frames[playIndex]` via DrawingCanvas.playbackFrameId
 * without touching the StrokeManager's current frame; `stopPlayback` commits
 * the shown frame as the new current one (so you draw where you stopped),
 * `cancelPlayback` drops it without committing.
 *
 * Reads the StrokeManager inline, so the caller must re-render on stroke /
 * frame changes (DrawingPanel does via redrawVersion).
 */
export function useAnimationPlayback({
  strokeManager,
  requestRedraw,
  onStrokesChanged,
  clearHighlight,
}: UseAnimationPlaybackOptions) {
  const [timelineOpen, setTimelineOpen] = useState(
    () => loadPref(TIMELINE_OPEN_STORAGE_KEY, '0') === '1',
  );
  const [onionRange, setOnionRange] = useState(() => {
    const v = Number(loadPref(ONION_RANGE_STORAGE_KEY, '1'));
    return v === 0 || v === 1 || v === 2 ? v : 1;
  });
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  // Synchronous mirror: stopPlayback runs from a pointer-down capture before
  // the canvas starts a stroke, so it can't wait for a React commit.
  const playStateRef = useRef({ playing: false, playIndex: 0 });
  useEffect(() => {
    playStateRef.current = { playing, playIndex };
  });

  const frames = strokeManager.getFrames();
  const frameCount = frames.length;
  const fps = strokeManager.getFps();
  useEffect(() => {
    if (!playing || frameCount <= 1) return;
    const id = setInterval(() => setPlayIndex((i) => (i + 1) % frameCount), 1000 / fps);
    return () => clearInterval(id);
  }, [playing, fps, frameCount]);

  /** Index on screen: the playback cursor while playing, else the current frame. */
  const shownIndex = playing ? playIndex % frameCount : strokeManager.getCurrentFrameIndex();
  /** Frame DrawingCanvas renders instead of the current one; null when not playing. */
  const playbackFrameId = playing ? frames[shownIndex] : null;

  /**
   * Stop playback synchronously (safe to call from a pointer-down capture
   * before the canvas starts a stroke): the shown frame becomes current.
   */
  const stopPlayback = useCallback(() => {
    const { playing: isPlaying, playIndex: idx } = playStateRef.current;
    if (!isPlaying) return;
    playStateRef.current = { playing: false, playIndex: idx };
    const frames = strokeManager.getFrames();
    strokeManager.setCurrentFrame(frames[idx % frames.length]);
    setPlaying(false);
    requestRedraw();
    onStrokesChanged?.({ flush: true });
  }, [strokeManager, requestRedraw, onStrokesChanged]);

  /** Drop playback WITHOUT committing the shown frame (the caller sets one). */
  const cancelPlayback = useCallback(() => {
    if (!playStateRef.current.playing) return;
    playStateRef.current = { playing: false, playIndex: 0 };
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (playStateRef.current.playing) {
      stopPlayback();
      return;
    }
    if (strokeManager.getFrames().length <= 1) return;
    clearHighlight();
    const start = strokeManager.getCurrentFrameIndex();
    playStateRef.current = { playing: true, playIndex: start };
    setPlayIndex(start);
    setPlaying(true);
  }, [strokeManager, stopPlayback, clearHighlight]);

  const selectFrame = useCallback(
    (frameId: string, opts?: { transient?: boolean }) => {
      cancelPlayback();
      strokeManager.setCurrentFrame(frameId);
      clearHighlight();
      requestRedraw();
      // Mid-scrub selections ride the debounce; discrete picks flush.
      onStrokesChanged?.(opts?.transient ? undefined : { flush: true });
    },
    [strokeManager, onStrokesChanged, cancelPlayback, clearHighlight, requestRedraw],
  );

  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      const frames = strokeManager.getFrames();
      const base = playStateRef.current.playing
        ? playStateRef.current.playIndex
        : strokeManager.getCurrentFrameIndex();
      const next = frames[base + dir];
      if (next) selectFrame(next);
    },
    [strokeManager, selectFrame],
  );

  const toggleTimeline = useCallback(() => {
    const next = !timelineOpen;
    if (!next) stopPlayback();
    savePref(TIMELINE_OPEN_STORAGE_KEY, next ? '1' : '0');
    setTimelineOpen(next);
    requestRedraw();
  }, [timelineOpen, stopPlayback, requestRedraw]);

  const changeOnionRange = useCallback((range: number) => {
    savePref(ONION_RANGE_STORAGE_KEY, String(range));
    setOnionRange(range);
  }, []);

  return {
    timelineOpen,
    toggleTimeline,
    onionRange,
    changeOnionRange,
    playing,
    shownIndex,
    playbackFrameId,
    stopPlayback,
    cancelPlayback,
    togglePlay,
    selectFrame,
    stepFrame,
  };
}
