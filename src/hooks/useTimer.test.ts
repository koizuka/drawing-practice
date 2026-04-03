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
})
