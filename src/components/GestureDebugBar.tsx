import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import type { DrawingCanvasDebugSnapshot } from './DrawingCanvas';
import type { GestureSessionStatus } from '../hooks/useGestureSession';

const POLL_INTERVAL_MS = 200;
const DELTA_WINDOW_MS = 5000;

export interface GestureDebugBarProps {
  /** Hide the bar entirely when false. */
  active: boolean;
  status: GestureSessionStatus;
  transitioning: boolean;
  /** Filled in by `DrawingCanvas` when it mounts; this component polls it. */
  debugSnapshotRef: React.RefObject<(() => DrawingCanvasDebugSnapshot) | null>;
}

/**
 * Diagnostic-only HUD for the gesture-session "can't draw" investigation.
 * Compact 2-line layout optimized for hand-copying values from iPad.
 * Items previously confirmed always-default (mode=pen, frz=0, pin=0,
 * rejP=0, rejS=0) have been pruned. Only `ago` and the event-flow counters
 * (ts/mv/end/strk/pe) remain on line 2 for narrowing down where touch
 * input flow is breaking.
 */
interface DeltaSample {
  at: number;
  ts: number;
  mv: number;
  end: number;
  strk: number;
}

export function GestureDebugBar({ active, status, transitioning, debugSnapshotRef }: GestureDebugBarProps) {
  const [snap, setSnap] = useState<DrawingCanvasDebugSnapshot | null>(null);
  const [delta, setDelta] = useState<{ ts: number; mv: number; end: number; strk: number } | null>(null);
  // Rolling window of recent samples; we compute "5s ago" by binary-search-ish
  // scan. Capped to ~50 entries (10s at 5Hz polling) to bound memory.
  const samplesRef = useRef<DeltaSample[]>([]);

  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      return;
    }
    const id = setInterval(() => {
      const fn = debugSnapshotRef.current;
      const next = fn ? fn() : null;
      setSnap(next);
      if (!next) return;
      const now = Date.now();
      samplesRef.current.push({
        at: now,
        ts: next.touchStartCount,
        mv: next.touchMoveCount,
        end: next.touchEndCount,
        strk: next.startStrokeCount,
      });
      // Prune samples older than 2× window (keeps the "5s ago" lookup cheap).
      const cutoff = now - DELTA_WINDOW_MS * 2;
      while (samplesRef.current.length > 0 && samplesRef.current[0].at < cutoff) {
        samplesRef.current.shift();
      }
      // Find the oldest sample within the [now - DELTA_WINDOW_MS] window.
      const target = now - DELTA_WINDOW_MS;
      let baseline: DeltaSample | null = null;
      for (const s of samplesRef.current) {
        if (s.at <= target) baseline = s;
        else break;
      }
      // Fallback to the oldest sample we have if nothing >= 5s old yet.
      const base = baseline ?? samplesRef.current[0] ?? null;
      if (base && base.at < now) {
        setDelta({
          ts: next.touchStartCount - base.ts,
          mv: next.touchMoveCount - base.mv,
          end: next.touchEndCount - base.end,
          strk: next.startStrokeCount - base.strk,
        });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, debugSnapshotRef]);

  if (!active) return null;

  const line1 = snap
    ? `tx=${transitioning ? 1 : 0} st=${status} ats=${snap.activeTouchesSize} sty=${snap.hasStylus ? 1 : 0} lastT=${snap.lastTouchType} ago=${snap.secsSinceLastStart < 0 ? '-' : `${snap.secsSinceLastStart}s`}`
    : `tx=${transitioning ? 1 : 0} st=${status} (snap=null)`;

  const d = delta ?? { ts: 0, mv: 0, end: 0, strk: 0 };
  const line2 = snap
    ? `ts=${snap.touchStartCount}(+${d.ts}) mv=${snap.touchMoveCount}(+${d.mv}) end=${snap.touchEndCount}(+${d.end}) strk=${snap.startStrokeCount}(+${d.strk})/${snap.endStrokeCommittedCount}:${snap.endStrokeNullCount} pe=${snap.enteredPinchCount} rejF=${snap.rejFrozen}`
    : '';

  return (
    <Box
      data-testid="gesture-debug-bar"
      sx={{
        flexShrink: 0,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.3,
        bgcolor: '#222',
        color: '#0f0',
        px: 1,
        py: 0.25,
        whiteSpace: 'pre',
        overflow: 'hidden',
        borderBottom: '1px solid #444',
      }}
    >
      {line1}
      {line2 && '\n'}
      {line2}
    </Box>
  );
}
