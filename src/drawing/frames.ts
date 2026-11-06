import type { Stroke } from './types';

/**
 * Animation frames (see docs/layers.md "Frames").
 *
 * Frames are an ordered list of STABLE ids, and a stroke points at its frame
 * by id (`Stroke.frameId`, absent ≡ DEFAULT_FRAME_ID). Reordering / inserting
 * / deleting frames therefore never rewrites stroke objects — which matters
 * because undo entries hold references to those objects.
 *
 * A layer with `shared: true` ignores frames entirely (its strokes show on
 * every frame — background, guide boxes, …).
 */

export const DEFAULT_FRAME_ID = 'frame-0';
/**
 * Marker frameId for strokes drawn on a `shared` layer. Never a real frame
 * (resolves to the first frame if ever evaluated), but lets "turn sharing
 * off" move exactly the strokes drawn while shared onto the current frame —
 * without it they'd be indistinguishable from frame-0 strokes.
 */
export const SHARED_FRAME_ID = 'shared';
export const MAX_FRAMES = 120;
export const FPS_OPTIONS = [4, 6, 8, 12, 24] as const;
export const DEFAULT_FPS = 8;

export interface FrameState {
  /** Frame ids in playback order. Never empty. */
  frames: string[];
  currentFrameId: string;
  fps: number;
  /** Rotoscope: frames step a YouTube reference (absent = not synced). */
  videoSync?: VideoSync;
}

/**
 * Rotoscope sync (docs/layers.md "Rotoscope"): frame at playback index `i`
 * shows the video at `offset + i * step` seconds. Index-based on purpose —
 * "the next frame is the next step of the video" is what tracing wants, and
 * it stays predictable when frames are appended. `step` is fixed when the
 * sync is set (1 / fps at that moment) so a later fps change only alters
 * playback speed, never which video moment a drawn frame was traced from.
 */
export interface VideoSync {
  videoId: string;
  /** Video time (s) of frame index 0. May be negative (earlier frames clamp to 0). */
  offset: number;
  /** Seconds of video per frame. */
  step: number;
}

const MAX_VIDEO_SYNC_STEP = 10;

/** Video time (s) for the frame at `index`. */
export function frameVideoTime(sync: VideoSync, index: number): number {
  return Math.max(0, sync.offset + index * sync.step);
}

/** Sync that puts frame `index` at video time `time`, stepping 1/fps. */
export function anchorVideoSync(
  videoId: string,
  time: number,
  index: number,
  fps: number,
): VideoSync {
  const step = 1 / fps;
  return { videoId, offset: time - index * step, step };
}

/** `m:ss.cc` for the rotoscope readout. */
export function formatVideoTime(seconds: number): string {
  const cs = Math.round(seconds * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const frac = cs % 100;
  return `${m}:${s < 10 ? '0' : ''}${s}.${frac < 10 ? '0' : ''}${frac}`;
}

export function sanitizeVideoSync(v: unknown): VideoSync | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { videoId, offset, step } = v as Record<string, unknown>;
  if (typeof videoId !== 'string' || videoId === '') return undefined;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return undefined;
  if (typeof step !== 'number' || !(step > 0) || step > MAX_VIDEO_SYNC_STEP) return undefined;
  return { videoId, offset, step };
}

/** What a renderer needs to filter strokes down to one frame. */
export interface FrameView {
  frames: readonly string[];
  frameId: string;
}

export function createDefaultFrameState(): FrameState {
  return { frames: [DEFAULT_FRAME_ID], currentFrameId: DEFAULT_FRAME_ID, fps: DEFAULT_FPS };
}

export function isDefaultFrameState(s: FrameState): boolean {
  return (
    s.frames.length === 1 &&
    s.frames[0] === DEFAULT_FRAME_ID &&
    s.currentFrameId === DEFAULT_FRAME_ID &&
    s.fps === DEFAULT_FPS &&
    !s.videoSync
  );
}

export function frameIdOf(stroke: Stroke): string {
  return stroke.frameId ?? DEFAULT_FRAME_ID;
}

/** Return `stroke` tagged with `frameId` (omitting the field for the default frame). */
export function withFrameId(stroke: Stroke, frameId: string | null): Stroke {
  const { frameId: _drop, ...rest } = stroke;
  void _drop;
  return frameId === null || frameId === DEFAULT_FRAME_ID ? rest : { ...rest, frameId };
}

/**
 * The frame a stroke effectively lives on. A stroke whose frame no longer
 * exists (e.g. drawn on a shared layer that was later made per-frame, after
 * its original frame was deleted) resolves to the first frame so it never
 * becomes unreachable.
 */
export function resolveFrameId(stroke: Stroke, frames: readonly string[]): string {
  const id = frameIdOf(stroke);
  return frames.includes(id) ? id : frames[0];
}

export function maxFrameSeq(frames: readonly string[]): number {
  let max = 0;
  for (const f of frames) {
    const m = /^frame-(\d+)$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function sanitizeFps(v: unknown): number {
  return typeof v === 'number' && (FPS_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_FPS;
}

/** Validate persisted frame data (dedupe, cap, non-empty, valid current / fps). */
export function sanitizeFrameState(
  raw: Partial<Record<keyof FrameState, unknown>> = {},
): FrameState {
  const frames: string[] = [];
  if (Array.isArray(raw.frames)) {
    for (const f of raw.frames) {
      if (frames.length >= MAX_FRAMES) break;
      // SHARED_FRAME_ID is a reserved stroke marker, never a real frame — a
      // persisted frame by that name would make real strokes look shared-origin.
      if (typeof f === 'string' && f !== '' && f !== SHARED_FRAME_ID && !frames.includes(f)) {
        frames.push(f);
      }
    }
  }
  if (frames.length === 0) frames.push(DEFAULT_FRAME_ID);
  const currentFrameId =
    typeof raw.currentFrameId === 'string' && frames.includes(raw.currentFrameId)
      ? raw.currentFrameId
      : frames[0];
  const videoSync = sanitizeVideoSync(raw.videoSync);
  return { frames, currentFrameId, fps: sanitizeFps(raw.fps), ...(videoSync ? { videoSync } : {}) };
}

/** Neighbor frame ids for onion skin: `[-1, -2, …]` before and `[+1, +2, …]` after. */
export function onionFrames(
  frames: readonly string[],
  frameId: string,
  range: number,
): { before: string[]; after: string[] } {
  const i = frames.indexOf(frameId);
  const before: string[] = [];
  const after: string[] = [];
  if (i < 0) return { before, after };
  for (let k = 1; k <= range; k++) {
    if (i - k >= 0) before.push(frames[i - k]);
    if (i + k < frames.length) after.push(frames[i + k]);
  }
  return { before, after };
}
