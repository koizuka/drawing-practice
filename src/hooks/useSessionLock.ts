import { useState, useEffect, useRef } from 'react'

const LOCK_NAME = 'drawing-practice-autosave'

const supportsLocks = typeof navigator !== 'undefined' && typeof navigator.locks !== 'undefined'

/**
 * Tries to acquire a Web Locks API lock to ensure only one tab
 * runs autosave at a time. Returns whether this tab holds the lock.
 * Falls back to true (unlocked) in browsers without Web Locks support.
 */
// Max retries and delay for acquiring the lock.
// During HMR the old component's lock is released asynchronously, so a
// short retry window avoids a false "another tab" warning while still
// detecting genuinely separate tabs quickly.
const RETRY_DELAY_MS = 100
const MAX_RETRIES = 3

export function useSessionLock(): boolean {
  const [hasLock, setHasLock] = useState(!supportsLocks)
  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!supportsLocks) return

    let unmounted = false

    function tryAcquire(retriesLeft: number) {
      navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (unmounted) {
          return Promise.resolve()
        }
        if (!lock) {
          if (retriesLeft > 0) {
            setTimeout(() => tryAcquire(retriesLeft - 1), RETRY_DELAY_MS)
          } else {
            setHasLock(false)
          }
          return Promise.resolve()
        }

        setHasLock(true)
        // Hold the lock until unmount by returning a pending promise
        return new Promise<void>((resolve) => {
          releaseRef.current = resolve
        })
      })
    }

    tryAcquire(MAX_RETRIES)

    return () => {
      unmounted = true
      releaseRef.current?.()
    }
  }, [])

  return hasLock
}
