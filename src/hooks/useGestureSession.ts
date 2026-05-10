import { useCallback, useEffect, useRef, useState } from 'react';
import type { PexelsOrientationFilter, PexelsPhoto } from '../utils/pexels';

const TICK_MS = 100;

export interface GestureSessionStartConfig {
  durationMs: number;
  query: string;
  orientation: PexelsOrientationFilter;
  initialPhotos: readonly PexelsPhoto[];
  page: number;
  hasMore: boolean;
}

export interface GestureSessionFetchResult {
  photos: PexelsPhoto[];
  page: number;
  hasMore: boolean;
}

export interface UseGestureSessionOptions {
  /** Apply the next photo as the active reference. Called for every advance,
   *  including the first photo on `start()`. */
  onPhotoChange: (photo: PexelsPhoto) => void;
  /** Called when the countdown reaches 0 — parent saves the current drawing
   *  and clears the canvas. Awaited before the next photo is loaded so the
   *  save doesn't race the reference change. Errors are logged and the
   *  session continues. */
  onTimeUp: (photo: PexelsPhoto) => Promise<void> | void;
  /** Called on every advance (timeup or skip) AFTER any onTimeUp has resolved
   *  and BEFORE the next photo is applied — parent typically clears strokes
   *  here. Skipped photos go through here too. */
  onAdvance?: (reason: 'timeup' | 'skip') => void;
  /** Fetch the next page of photos when the queue is exhausted but `hasMore`
   *  is still true. */
  fetchMore: (
    query: string,
    orientation: PexelsOrientationFilter,
    nextPage: number,
  ) => Promise<GestureSessionFetchResult>;
  /** Called once when the session ends naturally (queue exhausted with no
   *  more pages) or on `exit()`. */
  onSessionEnd?: () => void;
  /** Override the default `Math.random`-based shuffler. Tests pass an identity
   *  function so the queue order is deterministic. */
  shuffle?: <T>(items: readonly T[]) => T[];
}

export interface GestureSessionState {
  active: boolean;
  paused: boolean;
  loadingMore: boolean;
  durationMs: number;
  remainingMs: number;
  currentPhoto: PexelsPhoto | null;
  /** Number of poses completed via timeup (not including skips). */
  completedCount: number;
  /** Number of photos shown so far, including the current one. */
  totalShownCount: number;
  /** Photos still queued (not counting the current one). */
  queueRemaining: number;
  /** True while either the current queue still has items OR another page can
   *  be fetched. Used by the HUD to show "M枚以上残り". */
  hasMoreInBackend: boolean;
}

export interface GestureSessionActions {
  start: (config: GestureSessionStartConfig) => void;
  skip: () => void;
  pause: () => void;
  resume: () => void;
  exit: () => void;
}

type Status
  = 'idle'
    | 'running'
    | 'paused'
    | 'advancing-save'
    | 'advancing-skip';

interface InternalState extends GestureSessionState {
  status: Status;
}

const IDLE_STATE: InternalState = {
  status: 'idle',
  active: false,
  paused: false,
  loadingMore: false,
  durationMs: 0,
  remainingMs: 0,
  currentPhoto: null,
  completedCount: 0,
  totalShownCount: 0,
  queueRemaining: 0,
  hasMoreInBackend: false,
};

function defaultShuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Drives a gesture-drawing session over a queue of Pexels photos:
 * countdown → time-up → save (parent) → next photo. Skip jumps to the next
 * photo without saving. Pause halts the countdown. Exit ends the session.
 *
 * The hook owns the queue, page cursor, and countdown; the parent supplies
 * the side effects (save, reference swap, fetch-more) via callbacks.
 *
 * **Concurrency note:** advance steps await `onTimeUp` and `fetchMore`. A
 * concurrent `start()` or `exit()` bumps an internal sessionId; in-flight
 * advance work checks the id before applying its result, so a slow save
 * for an exited session can't accidentally load a photo into the next one.
 */
export function useGestureSession(opts: UseGestureSessionOptions): GestureSessionState & GestureSessionActions {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Mutable session-private data — not in render state to avoid churn.
  const queueRef = useRef<PexelsPhoto[]>([]);
  const queryRef = useRef<string>('');
  const orientationRef = useRef<PexelsOrientationFilter>('all');
  const pageRef = useRef<number>(0);
  const hasMoreRef = useRef<boolean>(false);
  // Bumped on start/exit so async advance work can detect that the session
  // it was driving is no longer current.
  const sessionIdRef = useRef<number>(0);

  const [state, setState] = useState<InternalState>(IDLE_STATE);

  // Tick: decrement remainingMs by TICK_MS while running, and transition
  // straight into 'advancing-save' in the same updater when the countdown
  // reaches 0. Combining the two into a single setState avoids a separate
  // setState-in-effect (which ESLint's react-hooks/set-state-in-effect rule
  // flags as a cascading-render risk) and removes a render between the
  // last visible "0" and the start of the save flow.
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => {
      setState((s) => {
        if (s.status !== 'running') return s;
        const nextRemaining = Math.max(0, s.remainingMs - TICK_MS);
        if (nextRemaining === 0) {
          return { ...s, remainingMs: 0, status: 'advancing-save' };
        }
        return { ...s, remainingMs: nextRemaining };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'advancing-save' && state.status !== 'advancing-skip') return;

    const isSave = state.status === 'advancing-save';
    const sessionAtStart = sessionIdRef.current;
    let cancelled = false;

    // `cancelled` covers effect cleanup (status changed mid-flight);
    // sessionIdRef covers start()/exit() racing with the awaited work.
    const isStale = () => cancelled || sessionIdRef.current !== sessionAtStart;

    void (async () => {
      if (isSave && state.currentPhoto) {
        try {
          await optsRef.current.onTimeUp(state.currentPhoto);
        }
        catch (e) {
          console.error('Gesture onTimeUp failed:', e);
        }
        if (isStale()) return;
      }

      // Run BEFORE the next photo loads so the parent can clear strokes
      // for the new pose.
      optsRef.current.onAdvance?.(isSave ? 'timeup' : 'skip');
      if (isStale()) return;

      let next = queueRef.current.shift();
      if (!next && hasMoreRef.current && queryRef.current) {
        setState(s => ({ ...s, loadingMore: true }));
        try {
          const res = await optsRef.current.fetchMore(
            queryRef.current,
            orientationRef.current,
            pageRef.current + 1,
          );
          if (isStale()) return;
          if (res.photos.length > 0) {
            const shuffled = (optsRef.current.shuffle ?? defaultShuffle)(res.photos);
            queueRef.current = shuffled;
            pageRef.current = res.page;
            hasMoreRef.current = res.hasMore;
            next = queueRef.current.shift();
          }
          else {
            hasMoreRef.current = false;
          }
        }
        catch (e) {
          console.error('Gesture fetchMore failed:', e);
          hasMoreRef.current = false;
        }
        if (isStale()) return;
        setState(s => ({ ...s, loadingMore: false }));
      }

      if (isStale()) return;

      if (!next) {
        sessionIdRef.current++;
        queueRef.current = [];
        queryRef.current = '';
        hasMoreRef.current = false;
        pageRef.current = 0;
        setState(IDLE_STATE);
        optsRef.current.onSessionEnd?.();
        return;
      }

      const nextPhoto = next;
      optsRef.current.onPhotoChange(nextPhoto);
      setState(s => ({
        ...s,
        status: 'running',
        active: true,
        paused: false,
        currentPhoto: nextPhoto,
        remainingMs: s.durationMs,
        completedCount: s.completedCount + (isSave ? 1 : 0),
        totalShownCount: s.totalShownCount + 1,
        queueRemaining: queueRef.current.length,
        hasMoreInBackend: queueRef.current.length > 0 || hasMoreRef.current,
      }));
    })();

    return () => {
      cancelled = true;
    };
  // currentPhoto is intentionally omitted — its value is captured in the
  // closure when the status transitions; recomputing the effect when the
  // photo changes (which we do INSIDE the effect itself) would re-trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // Cleanup on unmount: bump session id so any pending async work bails out.
  // We deliberately bump the LATEST id (not a captured-at-mount value);
  // capturing would defeat the purpose. The exhaustive-deps warning about
  // ref-in-cleanup is suppressed for this reason.
  useEffect(() => {
    return () => {
      sessionIdRef.current++; // eslint-disable-line react-hooks/exhaustive-deps -- intentional: latest id
    };
  }, []);

  const start = useCallback((config: GestureSessionStartConfig) => {
    if (config.initialPhotos.length === 0) return;
    sessionIdRef.current++;
    const shuffler = optsRef.current.shuffle ?? defaultShuffle;
    const queue = shuffler(config.initialPhotos);
    const first = queue.shift()!;
    queueRef.current = queue;
    queryRef.current = config.query;
    orientationRef.current = config.orientation;
    pageRef.current = config.page;
    hasMoreRef.current = config.hasMore;
    optsRef.current.onPhotoChange(first);
    setState({
      status: 'running',
      active: true,
      paused: false,
      loadingMore: false,
      durationMs: config.durationMs,
      remainingMs: config.durationMs,
      currentPhoto: first,
      completedCount: 0,
      totalShownCount: 1,
      queueRemaining: queue.length,
      hasMoreInBackend: queue.length > 0 || config.hasMore,
    });
  }, []);

  const skip = useCallback(() => {
    setState((s) => {
      if (s.status !== 'running' && s.status !== 'paused') return s;
      return { ...s, status: 'advancing-skip', paused: false };
    });
  }, []);

  const pause = useCallback(() => {
    setState((s) => {
      if (s.status !== 'running') return s;
      return { ...s, status: 'paused', paused: true };
    });
  }, []);

  const resume = useCallback(() => {
    setState((s) => {
      if (s.status !== 'paused') return s;
      return { ...s, status: 'running', paused: false };
    });
  }, []);

  const exit = useCallback(() => {
    sessionIdRef.current++;
    queueRef.current = [];
    queryRef.current = '';
    hasMoreRef.current = false;
    pageRef.current = 0;
    setState(IDLE_STATE);
    optsRef.current.onSessionEnd?.();
  }, []);

  return {
    active: state.active,
    paused: state.paused,
    loadingMore: state.loadingMore,
    durationMs: state.durationMs,
    remainingMs: state.remainingMs,
    currentPhoto: state.currentPhoto,
    completedCount: state.completedCount,
    totalShownCount: state.totalShownCount,
    queueRemaining: state.queueRemaining,
    hasMoreInBackend: state.hasMoreInBackend,
    start,
    skip,
    pause,
    resume,
    exit,
  };
}
