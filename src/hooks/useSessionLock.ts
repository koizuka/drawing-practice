import { useState, useEffect, useRef } from 'react'

const LOCK_NAME = 'drawing-practice-autosave'

const supportsLocks = typeof navigator !== 'undefined' && typeof navigator.locks !== 'undefined'

/**
 * Tries to acquire a Web Locks API lock to ensure only one tab
 * runs autosave at a time. Returns whether this tab holds the lock.
 * Falls back to true (unlocked) in browsers without Web Locks support.
 */
export function useSessionLock(): boolean {
  const [hasLock, setHasLock] = useState(!supportsLocks)
  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!supportsLocks) return

    let unmounted = false

    navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock || unmounted) {
        if (!unmounted) setHasLock(false)
        return Promise.resolve()
      }

      setHasLock(true)
      // Hold the lock until unmount by returning a pending promise
      return new Promise<void>((resolve) => {
        releaseRef.current = resolve
      })
    })

    return () => {
      unmounted = true
      releaseRef.current?.()
    }
  }, [])

  return hasLock
}
