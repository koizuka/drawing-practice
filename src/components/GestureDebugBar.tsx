import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import type { DrawingCanvasDebugSnapshot } from './DrawingCanvas';
import type { GestureSessionStatus } from '../hooks/useGestureSession';

const POLL_INTERVAL_MS = 200;

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
export function GestureDebugBar({ active, status, transitioning, debugSnapshotRef }: GestureDebugBarProps) {
  const [snap, setSnap] = useState<DrawingCanvasDebugSnapshot | null>(null);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const fn = debugSnapshotRef.current;
      setSnap(fn ? fn() : null);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, debugSnapshotRef]);

  if (!active) return null;

  const line1 = snap
    ? `tx=${transitioning ? 1 : 0} st=${status} ats=${snap.activeTouchesSize} sty=${snap.hasStylus ? 1 : 0} lastT=${snap.lastTouchType} ago=${snap.secsSinceLastStart < 0 ? '-' : `${snap.secsSinceLastStart}s`}`
    : `tx=${transitioning ? 1 : 0} st=${status} (snap=null)`;

  const line2 = snap
    ? `ts=${snap.touchStartCount} mv=${snap.touchMoveCount} end=${snap.touchEndCount} strk=${snap.startStrokeCount}/${snap.endStrokeCommittedCount}:${snap.endStrokeNullCount} pe=${snap.enteredPinchCount} rejF=${snap.rejFrozen}`
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
