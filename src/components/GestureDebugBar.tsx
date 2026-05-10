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
 * Shown above the panels while a session is active so the user can read off
 * internal state (input-frozen flag, active-touch count, pinch arming, last
 * touchType, etc.) when the bug reproduces. Polls the DrawingCanvas snapshot
 * getter every 200ms — no React state changes inside the canvas.
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

  const dc = snap
    ? `mode=${snap.mode} frz=${snap.inputFrozen ? 1 : 0} ats=${snap.activeTouchesSize} pin=${snap.pinchActive ? 1 : 0} sty=${snap.hasStylus ? 1 : 0} lastT=${snap.lastTouchType}`
    : 'mode=? frz=? ats=? pin=? sty=? lastT=?';

  const ev = snap
    ? `ts=${snap.touchStartCount} rejF=${snap.rejFrozen} rejP=${snap.rejPalm} rejS=${snap.rejStylusFilter} ago=${snap.secsSinceLastStart < 0 ? '-' : snap.secsSinceLastStart}s`
    : 'ts=? rejF=? rejP=? rejS=? ago=?';

  return (
    <Box
      data-testid="gesture-debug-bar"
      sx={{
        flexShrink: 0,
        fontFamily: 'monospace',
        fontSize: 11,
        bgcolor: '#222',
        color: '#0f0',
        px: 1,
        py: 0.25,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        borderBottom: '1px solid #444',
      }}
    >
      GS: tx=
      {transitioning ? 1 : 0}
      {' '}
      st=
      {status}
      {' | DC: '}
      {dc}
      {' | EV: '}
      {ev}
    </Box>
  );
}
