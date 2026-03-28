import { useState, useRef, useCallback, useEffect } from 'react'

export function useTimer() {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const startTimeRef = useRef<number | null>(null)
  const accumulatedRef = useRef(0)
  const rafIdRef = useRef<number>(0)
  const tickRef = useRef<() => void>(() => {})

  // Update tick function
  useEffect(() => {
    tickRef.current = () => {
      if (startTimeRef.current !== null) {
        setElapsedMs(accumulatedRef.current + (Date.now() - startTimeRef.current))
      }
      rafIdRef.current = requestAnimationFrame(tickRef.current)
    }
  }, [])

  const start = useCallback(() => {
    if (startTimeRef.current !== null) return
    startTimeRef.current = Date.now()
    setIsRunning(true)
    rafIdRef.current = requestAnimationFrame(tickRef.current)
  }, [])

  const pause = useCallback(() => {
    if (startTimeRef.current === null) return
    accumulatedRef.current += Date.now() - startTimeRef.current
    startTimeRef.current = null
    setIsRunning(false)
    cancelAnimationFrame(rafIdRef.current)
    setElapsedMs(accumulatedRef.current)
  }, [])

  const reset = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current)
    startTimeRef.current = null
    accumulatedRef.current = 0
    setElapsedMs(0)
    setIsRunning(false)
  }, [])

  // Pause/resume on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (startTimeRef.current !== null) {
          accumulatedRef.current += Date.now() - startTimeRef.current
          startTimeRef.current = null
          cancelAnimationFrame(rafIdRef.current)
        }
      } else {
        if (isRunning && startTimeRef.current === null) {
          startTimeRef.current = Date.now()
          rafIdRef.current = requestAnimationFrame(tickRef.current)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isRunning])

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafIdRef.current)
  }, [])

  return { elapsedMs, isRunning, start, pause, reset }
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
