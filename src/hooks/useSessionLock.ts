import { useState, useEffect, useRef } from 'react';

const LOCK_NAME = 'drawing-practice-autosave';

const supportsLocks = typeof navigator !== 'undefined' && typeof navigator.locks !== 'undefined';

/**
 * Tri-state lock acquisition status:
 * - `pending`  — acquisition in flight; callers shouldn't yet decide whether
 *   to write (no Alert, but also no autosave). Initial value when the Web
 *   Locks API is supported.
 * - `acquired` — this tab owns the lock; safe to autosave. Also the initial
 *   value when the Web Locks API isn't available (graceful degradation).
 * - `denied`   — another tab holds the lock; show "another tab" Alert and
 *   keep autosave suppressed.
 */
export type SessionLockStatus = 'pending' | 'acquired' | 'denied';

// During HMR the old component's lock is released asynchronously, so a short
// retry window avoids a false "another tab" warning while still detecting
// genuinely separate tabs quickly.
const RETRY_DELAY_MS = 100;
const MAX_RETRIES = 3;

/**
 * Acquires a Web Locks API lock to ensure only one tab runs autosave at a
 * time. Returns the acquisition status as a tri-state so callers can
 * distinguish "still resolving" from "definitively denied" — important for
 * the optimistic UX path where the "another tab" Alert should not flash
 * during the brief acquisition window, and autosave must not write before
 * the lock is confirmed (otherwise another holder's writes can race).
 */
export function useSessionLock(): SessionLockStatus {
  const [status, setStatus] = useState<SessionLockStatus>(supportsLocks ? 'pending' : 'acquired');
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!supportsLocks) return;

    let unmounted = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function tryAcquire(retriesLeft: number) {
      navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (unmounted) {
          return Promise.resolve();
        }
        if (!lock) {
          if (retriesLeft > 0) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              tryAcquire(retriesLeft - 1);
            }, RETRY_DELAY_MS);
          }
          else {
            setStatus('denied');
          }
          return Promise.resolve();
        }

        setStatus('acquired');
        // Hold the lock until unmount by returning a pending promise
        return new Promise<void>((resolve) => {
          releaseRef.current = resolve;
        });
      });
    }

    tryAcquire(MAX_RETRIES);

    return () => {
      unmounted = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      releaseRef.current?.();
    };
  }, []);

  return status;
}
