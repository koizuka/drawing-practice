import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Tap the bar itself to FREEZE the displayed values (so the user can read
 * them at leisure even though the underlying timer keeps ticking and
 * photos keep swapping). Tap the [COPY] area to copy the frozen text to
 * clipboard. Tap the bar again to unfreeze and resume polling.
 */
interface DeltaSample {
  at: number;
  ts: number;
  mv: number;
  mvOk: number;
  mvSkip: number;
  mvPin: number;
  end: number;
  strk: number;
  comm: number;
  nul: number;
}

interface DeltaValues {
  ts: number;
  mv: number;
  mvOk: number;
  mvSkip: number;
  mvPin: number;
  end: number;
  strk: number;
  comm: number;
  nul: number;
}

function buildLines(
  transitioning: boolean,
  status: GestureSessionStatus,
  snap: DrawingCanvasDebugSnapshot | null,
  delta: DeltaValues | null,
): string[] {
  if (!snap) return [`tx=${transitioning ? 1 : 0} st=${status} (no snap)`];
  const d = delta ?? { ts: 0, mv: 0, mvOk: 0, mvSkip: 0, mvPin: 0, end: 0, strk: 0, comm: 0, nul: 0 };
  return [
    `tx=${transitioning ? 1 : 0} st=${status} ats=${snap.activeTouchesSize} sty=${snap.hasStylus ? 1 : 0} lastT=${snap.lastTouchType} ago=${snap.secsSinceLastStart < 0 ? '-' : `${snap.secsSinceLastStart}s`}`,
    `ts=${snap.touchStartCount}(+${d.ts}) mv=${snap.touchMoveCount}(+${d.mv}) end=${snap.touchEndCount}(+${d.end}) strk=${snap.startStrokeCount}(+${d.strk}) com=${snap.endStrokeCommittedCount}(+${d.comm}) nul=${snap.endStrokeNullCount}(+${d.nul})`,
    `mvOk=${snap.mvAppendOk}(+${d.mvOk}) mvSkip=${snap.mvAppendSkip}(+${d.mvSkip}) mvPin=${snap.mvIntoPinch}(+${d.mvPin}) cur=${snap.curStrokePoints}`,
    `pe=${snap.enteredPinchCount} cnc=${snap.cancelStrokeCount} rejF=${snap.rejFrozen} rejP=${snap.rejPalm} rejS=${snap.rejStylusFilter} att=${snap.listenerAttachCount}`,
  ];
}

export function GestureDebugBar({ active, status, transitioning, debugSnapshotRef }: GestureDebugBarProps) {
  const [snap, setSnap] = useState<DrawingCanvasDebugSnapshot | null>(null);
  const [delta, setDelta] = useState<DeltaValues | null>(null);
  // When frozen, hold the snapshot at the moment of freeze.
  const [frozen, setFrozen] = useState<{ snap: DrawingCanvasDebugSnapshot; delta: DeltaValues | null; status: GestureSessionStatus; transitioning: boolean } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Rolling window of recent samples; we compute "5s ago" by binary-search-ish
  // scan. Capped to ~50 entries (10s at 5Hz polling) to bound memory.
  const samplesRef = useRef<DeltaSample[]>([]);

  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      return;
    }
    if (frozen) return; // pause polling while frozen so the displayed values don't churn
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
        mvOk: next.mvAppendOk,
        mvSkip: next.mvAppendSkip,
        mvPin: next.mvIntoPinch,
        end: next.touchEndCount,
        strk: next.startStrokeCount,
        comm: next.endStrokeCommittedCount,
        nul: next.endStrokeNullCount,
      });
      const cutoff = now - DELTA_WINDOW_MS * 2;
      while (samplesRef.current.length > 0 && samplesRef.current[0].at < cutoff) {
        samplesRef.current.shift();
      }
      const target = now - DELTA_WINDOW_MS;
      let baseline: DeltaSample | null = null;
      for (const s of samplesRef.current) {
        if (s.at <= target) baseline = s;
        else break;
      }
      const base = baseline ?? samplesRef.current[0] ?? null;
      if (base && base.at < now) {
        setDelta({
          ts: next.touchStartCount - base.ts,
          mv: next.touchMoveCount - base.mv,
          mvOk: next.mvAppendOk - base.mvOk,
          mvSkip: next.mvAppendSkip - base.mvSkip,
          mvPin: next.mvIntoPinch - base.mvPin,
          end: next.touchEndCount - base.end,
          strk: next.startStrokeCount - base.strk,
          comm: next.endStrokeCommittedCount - base.comm,
          nul: next.endStrokeNullCount - base.nul,
        });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, debugSnapshotRef, frozen]);

  const handleToggleFreeze = useCallback(() => {
    setFrozen((f) => {
      if (f) return null;
      if (!snap) return null;
      return { snap, delta, status, transitioning };
    });
    setCopyState('idle');
  }, [snap, delta, status, transitioning]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // don't toggle freeze
    const src = frozen ?? (snap ? { snap, delta, status, transitioning } : null);
    if (!src) return;
    const text = buildLines(src.transitioning, src.status, src.snap, src.delta).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    }
    catch {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  }, [frozen, snap, delta, status, transitioning]);

  if (!active) return null;

  const view = frozen ?? { snap, delta, status, transitioning };
  const lines = buildLines(view.transitioning, view.status, view.snap, view.delta);

  return (
    <Box
      data-testid="gesture-debug-bar"
      onClick={handleToggleFreeze}
      sx={{
        flexShrink: 0,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.3,
        bgcolor: frozen ? '#553300' : '#222',
        color: frozen ? '#ffcc66' : '#0f0',
        px: 1,
        py: 0.25,
        whiteSpace: 'pre',
        overflow: 'hidden',
        borderBottom: '1px solid #444',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      <Box
        component="span"
        onClick={handleCopy}
        sx={{
          position: 'absolute',
          top: 2,
          right: 4,
          fontSize: 10,
          bgcolor: copyState === 'copied' ? '#2a8' : copyState === 'failed' ? '#a22' : '#444',
          color: '#fff',
          px: 0.75,
          py: 0.125,
          borderRadius: 0.5,
        }}
      >
        {copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'COPY FAIL' : 'COPY'}
      </Box>
      {frozen && (
        <Box component="span" sx={{ position: 'absolute', top: 2, right: 56, fontSize: 10, color: '#ffcc66' }}>
          [FROZEN — tap to unfreeze]
        </Box>
      )}
      {lines.join('\n')}
    </Box>
  );
}
