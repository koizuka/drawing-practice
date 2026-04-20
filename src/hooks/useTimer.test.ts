import { renderHook, act } from '@testing-library/react'
import { formatTime, useTimer } from './useTimer'

describe('formatTime', () => {
  it('formats 0ms', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds', () => {
    expect(formatTime(5000)).toBe('0:05')
    expect(formatTime(59000)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(60000)).toBe('1:00')
    expect(formatTime(90000)).toBe('1:30')
    expect(formatTime(3661000)).toBe('61:01')
  })

  it('truncates milliseconds', () => {
    expect(formatTime(1500)).toBe('0:01')
    expect(formatTime(999)).toBe('0:00')
  })
})

describe('useTimer', () => {
  describe('restore', () => {
    it('sets elapsed time without starting the timer', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.restore(5000)
      })

      expect(result.current.elapsedMs).toBe(5000)
      expect(result.current.isRunning).toBe(false)
    })

    it('stops a running timer and sets elapsed time', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.start()
      })
      expect(result.current.isRunning).toBe(true)

      act(() => {
        result.current.restore(12000)
      })

      expect(result.current.elapsedMs).toBe(12000)
      expect(result.current.isRunning).toBe(false)
    })

    it('allows start after restore to continue from restored time', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.restore(10000)
      })

      act(() => {
        result.current.start()
      })

      expect(result.current.isRunning).toBe(true)
      // elapsedMs should be >= 10000 (restored base)
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(10000)
    })
  })

  describe('reset + start', () => {
    it('start() is idempotent while already running', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.start()
      })
      expect(result.current.isRunning).toBe(true)

      // Calling start() again must be a no-op (no re-initialization of startTimeRef
      // that would cause double-counting). Verify isRunning stays true and no error.
      act(() => {
        result.current.start()
        result.current.start()
      })
      expect(result.current.isRunning).toBe(true)
    })

    it('start() after reset() resumes from 0', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.restore(45000)
      })
      expect(result.current.elapsedMs).toBe(45000)

      act(() => {
        result.current.reset()
      })
      expect(result.current.elapsedMs).toBe(0)
      expect(result.current.isRunning).toBe(false)

      act(() => {
        result.current.start()
      })
      expect(result.current.isRunning).toBe(true)
      // Still near 0 immediately after start (no accumulated time from the pre-reset state).
      expect(result.current.elapsedMs).toBeLessThan(100)
    })

    it('pause() + start() accumulates without double-counting', () => {
      const { result } = renderHook(() => useTimer())

      // Seed a known accumulated value using restore, then start.
      act(() => {
        result.current.restore(3000)
        result.current.start()
      })

      // Pause — accumulated should be >= 3000 but not wildly larger.
      act(() => {
        result.current.pause()
      })
      expect(result.current.isRunning).toBe(false)
      const afterPause = result.current.elapsedMs
      expect(afterPause).toBeGreaterThanOrEqual(3000)

      // Restart; elapsedMs should stay >= afterPause (never rewinds below it).
      act(() => {
        result.current.start()
      })
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(afterPause)
    })
  })

  describe('visibility change', () => {
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')

    afterEach(() => {
      if (originalHidden) {
        Object.defineProperty(Document.prototype, 'hidden', originalHidden)
      }
    })

    function setHidden(hidden: boolean) {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('pauses the animation loop while the document is hidden, and resumes on visible', () => {
      const { result } = renderHook(() => useTimer())

      act(() => {
        result.current.start()
      })
      expect(result.current.isRunning).toBe(true)

      // Hide the tab — the hook should stop the rAF loop. isRunning is left unchanged
      // (the hook keeps the flag so it knows to auto-resume on visible).
      act(() => {
        setHidden(true)
      })
      expect(result.current.isRunning).toBe(true)

      // Show the tab again — rAF loop restarts, no state corruption.
      act(() => {
        setHidden(false)
      })
      expect(result.current.isRunning).toBe(true)
    })
  })

  describe('reset behavior', () => {
    it('reset() zeroes elapsed and stops the timer even if never started', () => {
      const { result } = renderHook(() => useTimer())
      act(() => {
        result.current.reset()
      })
      expect(result.current.elapsedMs).toBe(0)
      expect(result.current.isRunning).toBe(false)
    })

    it('reset() while running stops the timer and zeroes elapsed', () => {
      const { result } = renderHook(() => useTimer())
      act(() => {
        result.current.start()
      })
      act(() => {
        result.current.reset()
      })
      expect(result.current.elapsedMs).toBe(0)
      expect(result.current.isRunning).toBe(false)
    })
  })
})
