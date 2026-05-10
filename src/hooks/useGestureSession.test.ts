import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useGestureSession, type GestureSessionFetchResult, type UseGestureSessionOptions } from './useGestureSession';
import type { PexelsOrientationFilter, PexelsPhoto } from '../utils/pexels';

function makePhoto(id: number): PexelsPhoto {
  return {
    id,
    width: 1920,
    height: 1280,
    url: `https://www.pexels.com/photo/sample-${id}/`,
    photographer: `Photographer ${id}`,
    photographer_url: `https://www.pexels.com/@photog-${id}`,
    photographer_id: id,
    alt: `pose ${id}`,
    src: {
      original: `https://images.pexels.com/photos/${id}/orig.jpg`,
      large2x: `https://images.pexels.com/photos/${id}/large2x.jpg`,
      large: '',
      medium: '',
      small: '',
      portrait: '',
      landscape: '',
      tiny: `https://images.pexels.com/photos/${id}/tiny.jpg`,
    },
  };
}

type OnPhotoChange = UseGestureSessionOptions['onPhotoChange'];
type OnTimeUp = UseGestureSessionOptions['onTimeUp'];
type OnAdvance = NonNullable<UseGestureSessionOptions['onAdvance']>;
type OnSessionEnd = NonNullable<UseGestureSessionOptions['onSessionEnd']>;
type FetchMore = (
  query: string,
  orientation: PexelsOrientationFilter,
  nextPage: number,
) => Promise<GestureSessionFetchResult>;

interface MockOpts {
  onPhotoChange: ReturnType<typeof vi.fn<OnPhotoChange>>;
  onTimeUp: ReturnType<typeof vi.fn<OnTimeUp>>;
  onAdvance: ReturnType<typeof vi.fn<OnAdvance>>;
  onSessionEnd: ReturnType<typeof vi.fn<OnSessionEnd>>;
  fetchMore: ReturnType<typeof vi.fn<FetchMore>>;
}

function makeMocks(): MockOpts {
  return {
    onPhotoChange: vi.fn<OnPhotoChange>(),
    onTimeUp: vi.fn<OnTimeUp>().mockResolvedValue(undefined),
    onAdvance: vi.fn<OnAdvance>(),
    onSessionEnd: vi.fn<OnSessionEnd>(),
    fetchMore: vi.fn<FetchMore>(),
  };
}

function setup(mocks: MockOpts) {
  return renderHook(() => useGestureSession({
    onPhotoChange: mocks.onPhotoChange,
    onTimeUp: mocks.onTimeUp,
    onAdvance: mocks.onAdvance,
    onSessionEnd: mocks.onSessionEnd,
    fetchMore: mocks.fetchMore,
    // Identity shuffler so the test queue order is deterministic.
    shuffle: items => [...items],
  }));
}

describe('useGestureSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the first photo and counts down', () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    const photos = [makePhoto(1), makePhoto(2)];
    act(() => {
      result.current.start({
        durationMs: 1000,
        query: 'pose',
        orientation: 'all',
        initialPhotos: photos,
        page: 1,
        hasMore: false,
      });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.currentPhoto?.id).toBe(1);
    expect(result.current.remainingMs).toBe(1000);
    expect(result.current.queueRemaining).toBe(1);
    expect(result.current.totalShownCount).toBe(1);
    expect(mocks.onPhotoChange).toHaveBeenCalledWith(photos[0]);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.remainingMs).toBeLessThan(1000);
    expect(result.current.remainingMs).toBeGreaterThan(0);
  });

  it('saves and advances on time-up', async () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    const photos = [makePhoto(1), makePhoto(2)];
    act(() => {
      result.current.start({
        durationMs: 500,
        query: 'pose',
        orientation: 'all',
        initialPhotos: photos,
        page: 1,
        hasMore: false,
      });
    });

    await act(async () => {
      // Drain countdown; advanceTimersByTimeAsync flushes microtasks so the
      // advance effect's awaited work runs.
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.onTimeUp).toHaveBeenCalledTimes(1);
    expect(mocks.onTimeUp).toHaveBeenCalledWith(photos[0]);
    expect(mocks.onAdvance).toHaveBeenCalledWith('timeup');
    expect(mocks.onPhotoChange).toHaveBeenLastCalledWith(photos[1]);
    expect(result.current.currentPhoto?.id).toBe(2);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.totalShownCount).toBe(2);
    expect(result.current.remainingMs).toBe(500);
  });

  it('skip advances without saving and does not increment completedCount', async () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 1000,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [makePhoto(1), makePhoto(2)],
        page: 1,
        hasMore: false,
      });
    });

    await act(async () => {
      result.current.skip();
      // Flush microtasks so the advance effect's awaited work resolves
      // without ticking the re-armed interval forever.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.onTimeUp).not.toHaveBeenCalled();
    expect(mocks.onAdvance).toHaveBeenCalledWith('skip');
    expect(result.current.currentPhoto?.id).toBe(2);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.totalShownCount).toBe(2);
  });

  it('pause halts the countdown, resume continues from where it stopped', () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 1000,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [makePhoto(1)],
        page: 1,
        hasMore: false,
      });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    const beforePause = result.current.remainingMs;
    expect(beforePause).toBeLessThan(1000);

    act(() => {
      result.current.pause();
    });
    expect(result.current.paused).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Frozen while paused
    expect(result.current.remainingMs).toBe(beforePause);

    act(() => {
      result.current.resume();
    });
    expect(result.current.paused).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.remainingMs).toBeLessThan(beforePause);
  });

  it('exit clears state and fires onSessionEnd', () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 1000,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [makePhoto(1), makePhoto(2)],
        page: 1,
        hasMore: false,
      });
    });

    act(() => {
      result.current.exit();
    });

    expect(result.current.active).toBe(false);
    expect(result.current.currentPhoto).toBeNull();
    expect(result.current.queueRemaining).toBe(0);
    expect(mocks.onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('fetchMore is called when the queue empties and hasMore is true', async () => {
    const mocks = makeMocks();
    const fetched: GestureSessionFetchResult = {
      photos: [makePhoto(10), makePhoto(11)],
      page: 2,
      hasMore: false,
    };
    mocks.fetchMore.mockResolvedValue(fetched);
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 500,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [makePhoto(1)],
        page: 1,
        hasMore: true,
      });
    });

    // Drain the only initial photo via skip; queue is now empty, fetchMore must run.
    await act(async () => {
      result.current.skip();
      // Flush microtasks so the advance effect's awaited work resolves
      // without ticking the re-armed interval forever.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.fetchMore).toHaveBeenCalledWith('pose', 'all', 2);
    expect(result.current.currentPhoto?.id).toBe(10);
    expect(result.current.queueRemaining).toBe(1);
  });

  it('ends the session when both the queue and backend are exhausted', async () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 500,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [makePhoto(1)],
        page: 1,
        hasMore: false,
      });
    });

    await act(async () => {
      result.current.skip();
      // Flush microtasks so the advance effect's awaited work resolves
      // without ticking the re-armed interval forever.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.active).toBe(false);
    expect(mocks.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMore).not.toHaveBeenCalled();
  });

  it('start with empty initial photos is a no-op', () => {
    const mocks = makeMocks();
    const { result } = setup(mocks);

    act(() => {
      result.current.start({
        durationMs: 500,
        query: 'pose',
        orientation: 'all',
        initialPhotos: [],
        page: 1,
        hasMore: false,
      });
    });

    expect(result.current.active).toBe(false);
    expect(mocks.onPhotoChange).not.toHaveBeenCalled();
  });

  it('onTimeUp errors are logged and the session continues', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const mocks = makeMocks();
      mocks.onTimeUp.mockRejectedValue(new Error('save failed'));
      const { result } = setup(mocks);

      act(() => {
        result.current.start({
          durationMs: 500,
          query: 'pose',
          orientation: 'all',
          initialPhotos: [makePhoto(1), makePhoto(2)],
          page: 1,
          hasMore: false,
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Advanced to next photo despite the save error.
      expect(result.current.currentPhoto?.id).toBe(2);
      expect(consoleErr).toHaveBeenCalled();
    }
    finally {
      consoleErr.mockRestore();
    }
  });
});
