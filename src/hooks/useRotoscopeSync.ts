import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { StrokeManager } from '../drawing/StrokeManager';
import { anchorVideoSync, frameVideoTime } from '../drawing/frames';
import type { VideoSyncBridge } from '../utils/videoSyncBridge';

interface UseRotoscopeSyncOptions {
  strokeManager: StrokeManager;
  /** Video id of the current YouTube reference, or null for any other source. */
  youtubeVideoId: string | null;
  videoBridge?: VideoSyncBridge;
  playing: boolean;
  /** Frame index on screen (playback cursor or current frame). */
  shownIndex: number;
  stopPlayback: () => void;
  /** The sync anchor changed (an undoable-free doc edit → redraw + flush). */
  onSyncChanged: () => void;
}

/**
 * Rotoscope (docs/layers.md "Rotoscope"): frame i ↔ video time
 * `offset + i·step`. Only live while the drawing's sync names the YouTube
 * video that is the current reference. Drives the player through the
 * VideoSyncBridge — parks it on the current frame while editing, and follows
 * playback (letting the video run at real speed when one frame step equals
 * one playback tick).
 *
 * Returns the timeline's `videoSync` prop, or undefined for non-YouTube
 * references.
 */
export function useRotoscopeSync({
  strokeManager,
  youtubeVideoId,
  videoBridge,
  playing,
  shownIndex,
  stopPlayback,
  onSyncChanged,
}: UseRotoscopeSyncOptions) {
  const videoSync = strokeManager.getVideoSync();
  const syncActive = !!videoSync && youtubeVideoId !== null && videoSync.videoId === youtubeVideoId;
  const syncOffset = syncActive ? videoSync.offset : null;
  const syncStep = syncActive ? videoSync.step : null;
  const currentFrameIndex = strokeManager.getCurrentFrameIndex();
  const fps = strokeManager.getFps();
  // Playback lets the video run when one frame step equals one playback tick
  // (smooth, real speed); otherwise every tick seeks to the frame's moment.
  const syncRealtime = syncStep !== null && Math.abs(syncStep * fps - 1) < 0.01;
  // What the playback branch last aligned to; any change of mode or player
  // readiness forces a fresh seek (a seek sent before the player was ready,
  // or a switch into / out of realtime, must not wait for the next wrap).
  const lastSyncedRef = useRef<{ index: number; realtime: boolean; ready: number } | null>(null);
  // Re-park when the player becomes ready (seeks sent while it was still
  // loading — e.g. right after a reload — are dropped).
  const playerReadyVersion = useSyncExternalStore(
    useCallback((cb: () => void) => videoBridge?.subscribeReady(cb) ?? (() => {}), [videoBridge]),
    () => videoBridge?.getReadyVersion() ?? 0,
  );
  useEffect(() => {
    if (syncOffset === null || syncStep === null || !videoBridge) {
      lastSyncedRef.current = null;
      return;
    }
    // Only the mapping is needed here; the effect keys on these primitives
    // (getVideoSync returns a fresh copy each render).
    const sync = { offset: syncOffset, step: syncStep };
    if (!playing) {
      // Editing: park the video on the current frame's moment.
      lastSyncedRef.current = null;
      videoBridge.seekTo(frameVideoTime(sync, currentFrameIndex), { play: false });
      return;
    }
    const prev = lastSyncedRef.current;
    const fresh =
      prev === null || prev.realtime !== syncRealtime || prev.ready !== playerReadyVersion;
    lastSyncedRef.current = {
      index: shownIndex,
      realtime: syncRealtime,
      ready: playerReadyVersion,
    };
    if (syncRealtime) {
      // Start, every loop wrap, and any mode / readiness change re-align; in
      // between the video runs.
      if (fresh || shownIndex < prev.index) {
        videoBridge.seekTo(frameVideoTime(sync, shownIndex), { play: true });
      }
    } else if (fresh || prev.index !== shownIndex) {
      videoBridge.seekTo(frameVideoTime(sync, shownIndex), { play: false });
    }
  }, [
    syncOffset,
    syncStep,
    syncRealtime,
    playing,
    shownIndex,
    currentFrameIndex,
    videoBridge,
    playerReadyVersion,
  ]);

  const toggle = useCallback(() => {
    if (!youtubeVideoId) return;
    stopPlayback();
    if (syncActive) {
      strokeManager.setVideoSync(null);
      // Nothing drives the video after this — don't leave it running.
      videoBridge?.pause();
    } else {
      // Anchor: the current frame = where the video is right now. No report
      // from the player yet ⇒ refuse rather than silently anchor at 0 (the
      // toggle is disabled in that state anyway).
      const now = videoBridge?.getCurrentTime() ?? null;
      if (now === null) return;
      strokeManager.setVideoSync(
        anchorVideoSync(
          youtubeVideoId,
          now,
          strokeManager.getCurrentFrameIndex(),
          strokeManager.getFps(),
        ),
      );
    }
    onSyncChanged();
  }, [youtubeVideoId, syncActive, strokeManager, videoBridge, stopPlayback, onSyncChanged]);

  if (!youtubeVideoId) return undefined;
  return {
    active: syncActive,
    // Anchoring needs a reported position (re-evaluated when the player turns
    // ready — playerReadyVersion re-renders).
    canEnable: syncActive || (videoBridge?.getCurrentTime() ?? null) !== null,
    time: syncActive && videoSync ? frameVideoTime(videoSync, shownIndex) : null,
    onToggle: toggle,
  };
}
