import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { Copy, Eraser, Minus, Maximize2 } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import {
  diag,
  readState,
  getLog,
  clearLog,
  serializeLog,
  persistLog,
  logEvent,
  resetDiag,
  getRecoveryActions,
  type DiagState,
  type DiagLogEntry,
} from '../drawing/touchDiagnostics';

/**
 * Developer HUD for the iPad Pencil "strokes stop registering" investigation.
 * Polls the touchDiagnostics singleton a few times a second (it never causes
 * DrawingCanvas to re-render). Mounted only when `?diag=touch` is set — see
 * DrawingPanel. This deliberately deviates from the panel/toolbar skeleton in
 * ui-design-principles.md §4 because it is a transient debug overlay laid over
 * the running app, not part of the normal workflow.
 */

const POLL_MS = 250;
// Thresholds (ms) after which "no redraw" / "no rAF tick" is treated as stalled.
const REDRAW_STALL_MS = 500;
const RAF_STALL_MS = 500;

interface Snapshot {
  counters: typeof diag;
  state: DiagState | null;
  log: readonly DiagLogEntry[];
  now: number;
}

function takeSnapshot(): Snapshot {
  return {
    // Shallow copy so React sees a new object each tick.
    counters: { ...diag },
    state: readState(),
    log: getLog().slice(-40),
    now: performance.now(),
  };
}

export default function TouchDiagnosticsOverlay() {
  const [snap, setSnap] = useState<Snapshot>(() => takeSnapshot());
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Previous tick's counters, for the watchdog's delta detection.
  const prevRef = useRef<typeof diag>({ ...diag });
  // Latch so each stuck episode is logged once at onset, not every tick.
  const stuckRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      const prev = prevRef.current;
      const cur = diag;
      const now = performance.now();

      // Watchdog: classify the onset of an anomalous episode and log it once.
      // Deltas are per-tick. We deliberately do NOT auto-flag the doc-vs-canvas
      // touch gap ("targetLost"): the document listener also sees toolbar /
      // overlay / reference-panel touches, so doc > canvas is normal — that
      // signal is left for manual inspection via the "canvas vs doc move" row.
      const moveDelta = cur.touchmove - prev.touchmove;
      const appendDelta = cur.appendOk - prev.appendOk;
      const redrawDelta = cur.redrawAll - prev.redrawAll;
      const rafDelta = cur.rafTick - prev.rafTick;
      const rejDelta = (cur.rejStylusFilterStart - prev.rejStylusFilterStart)
        + (cur.rejStylusFilterMove - prev.rejStylusFilterMove);
      const state = readState();

      let stuck: { reason: string; detail: Record<string, unknown> } | null = null;
      if (rafDelta === 0 && cur.lastRafAt > 0 && now - cur.lastRafAt > RAF_STALL_MS) {
        // rAF stopped — main thread stall OR the page was backgrounded (a tab
        // switch throttles rAF), so this also fires right after a visibility reset.
        stuck = { reason: 'rafStalled', detail: { sinceRafMs: Math.round(now - cur.lastRafAt) } };
      }
      else if (rejDelta > 0) {
        // A touch was dropped by the stylus filter (the confirmed direct-as-
        // Pencil mechanism). High-confidence signal.
        stuck = { reason: 'stylusFilterDrop', detail: { rejDelta, rejStart: cur.rejStylusFilterStart, rejMove: cur.rejStylusFilterMove } };
      }
      else if (moveDelta > 0 && appendDelta === 0 && state?.mode === 'pen' && state?.drawing) {
        // Genuinely silent drop: pen-mode moves during an active stroke that
        // neither appended nor were rejected. (Eraser/lasso moves legitimately
        // never append, so they're excluded via mode + drawing.)
        stuck = { reason: 'inputDropped', detail: { moveDelta } };
      }
      else if (appendDelta > 0 && redrawDelta === 0) {
        // Points were appended but redrawAll never ran this whole tick — data
        // added without being painted. (Using redrawDelta, not lastRedrawAt
        // age, avoids the idle-gap race where the first append after a pause
        // is sampled before its rAF redraw completes.)
        stuck = { reason: 'presentStalled', detail: { appendDelta, sinceRedrawMs: Math.round(now - cur.lastRedrawAt) } };
      }

      if (stuck && !stuckRef.current) {
        stuckRef.current = true;
        logEvent('watchdog', stuck);
        persistLog();
      }
      else if (!stuck) {
        stuckRef.current = false;
      }

      prevRef.current = { ...cur };
      setSnap(takeSnapshot());
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const recovery = useCallback((fn: 'resetSession' | 'clearStylus' | 'forceRedraw' | 'nudgeCompositor') => {
    getRecoveryActions()?.[fn]();
  }, []);

  const handleCopy = useCallback(async () => {
    persistLog();
    const text = serializeLog();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    catch {
      // Clipboard API can be unavailable (insecure context / permission).
      // Fall back to selecting the textarea content for manual copy.
      window.prompt('Copy diagnostics log:', text.slice(0, 2000));
    }
  }, []);

  const c = snap.counters;
  const s = snap.state;
  const redrawAge = c.lastRedrawAt > 0 ? Math.round(snap.now - c.lastRedrawAt) : -1;
  const rafAge = c.lastRafAt > 0 ? Math.round(snap.now - c.lastRafAt) : -1;
  const targetGap = c.docTouchmove - c.touchmove;

  if (collapsed) {
    return (
      <Box
        sx={{
          position: 'fixed', top: 8, right: 8, zIndex: 1100,
          bgcolor: 'rgba(0,0,0,0.75)', color: '#0f0', borderRadius: 1,
          px: 1, py: 0.25, fontFamily: 'monospace', fontSize: '0.7rem',
          display: 'flex', alignItems: 'center', gap: 0.5,
        }}
      >
        <span>{`diag #${c.heartbeat} a${c.appendOk}`}</span>
        <ToolbarTooltip title="Expand diagnostics">
          <IconButton size="small" onClick={() => setCollapsed(false)} sx={{ color: '#0f0', p: 0.25 }}>
            <Maximize2 size={14} />
          </IconButton>
        </ToolbarTooltip>
      </Box>
    );
  }

  const row = (label: string, value: ReactNode, color?: string) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, color: color ?? 'inherit' }}>
      <span>{label}</span>
      <span>{value}</span>
    </Box>
  );

  const sectionSx = { mt: 0.5, pt: 0.5, borderTop: '1px solid rgba(255,255,255,0.2)' } as const;

  return (
    <Box
      sx={{
        position: 'fixed', top: 8, right: 8, zIndex: 1100,
        width: 280, maxHeight: '80dvh',
        display: 'flex', flexDirection: 'column',
        bgcolor: 'rgba(0,0,0,0.82)', color: '#eee', borderRadius: 1,
        fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.45,
        p: 1, boxShadow: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.78rem', fontWeight: 700 }}>
          touch diagnostics
        </Typography>
        <ToolbarTooltip title="Collapse">
          <IconButton size="small" onClick={() => setCollapsed(true)} sx={{ color: '#eee', p: 0.25 }}>
            <Minus size={14} />
          </IconButton>
        </ToolbarTooltip>
      </Box>

      <Box sx={{ overflow: 'auto', flex: '0 1 auto' }}>
        {/* Input (canvas) */}
        <Box sx={sectionSx}>
          {row('start / move / end', `${c.touchstart} / ${c.touchmove} / ${c.touchend}`)}
          {row('cancel', c.touchcancel, c.touchcancel > 0 ? '#ff9' : undefined)}
          {row('type sty/dir/und', `${c.touchTypeStylus} / ${c.touchTypeDirect} / ${c.touchTypeUndefined}`)}
        </Box>
        {/* Input (document) */}
        <Box sx={sectionSx}>
          {row('doc move', c.docTouchmove)}
          {row('canvas vs doc move', `${c.touchmove} / ${c.docTouchmove}`, targetGap > 2 ? '#9cf' : undefined)}
        </Box>
        {/* Rejections */}
        <Box sx={sectionSx}>
          {row('rej frozen', c.rejInputFrozen)}
          {row('rej pinch', c.rejPinch, c.rejPinch > 0 ? '#fc6' : undefined)}
          {row('rej stylus s/m', `${c.rejStylusFilterStart} / ${c.rejStylusFilterMove}`,
            (c.rejStylusFilterStart + c.rejStylusFilterMove) > 0 ? '#fc6' : undefined)}
          {row('append skip', c.appendSkip)}
        </Box>
        {/* State */}
        <Box sx={sectionSx}>
          {row('mode / drawing', s ? `${s.mode} / ${s.drawing}` : '?')}
          {row('hasStylus', String(s?.hasStylus ?? '?'), s?.hasStylus ? '#fc6' : undefined)}
          {row('activeTouches', s ? `${s.activeTouchCount} [${s.activeTouchIds.join(',')}]` : '?')}
          {row('pinchActive', String(s?.pinchActive ?? '?'), s?.pinchActive ? '#fc6' : undefined)}
        </Box>
        {/* Data */}
        <Box sx={sectionSx}>
          {row('start/append/commit', `${c.startStroke} / ${c.appendOk} / ${c.endCommit}`)}
          {row('cancel', c.cancelStroke)}
          {row('strokeCount', s?.strokeCount ?? '?')}
        </Box>
        {/* Render */}
        <Box sx={sectionSx}>
          {row('redrawAll', c.redrawAll)}
          {row('heartbeat', c.heartbeat)}
          {row('last redraw (ms)', redrawAge, redrawAge > REDRAW_STALL_MS ? '#f66' : undefined)}
        </Box>
        {/* rAF liveness */}
        <Box sx={sectionSx}>
          {row('rafTick', c.rafTick)}
          {row('last rAF (ms)', rafAge, rafAge > RAF_STALL_MS ? '#f66' : undefined)}
        </Box>
        {/* Reset */}
        <Box sx={sectionSx}>
          {row('resets', `${c.resetCount} (${c.lastResetTrigger ?? '-'})`)}
        </Box>
      </Box>

      {/* Recovery / live mitigations */}
      <Box sx={{ ...sectionSx, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        <Button size="small" variant="outlined" sx={btnSx} onClick={() => recovery('resetSession')}>Reset session</Button>
        <Button size="small" variant="outlined" sx={btnSx} onClick={() => recovery('clearStylus')}>Clear stylus</Button>
        <Button size="small" variant="outlined" sx={btnSx} onClick={() => recovery('forceRedraw')}>Force redraw</Button>
        <Button size="small" variant="outlined" sx={btnSx} onClick={() => recovery('nudgeCompositor')}>Nudge comp.</Button>
      </Box>

      {/* Event log */}
      <Box sx={{ ...sectionSx, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Button size="small" variant="contained" startIcon={<Copy size={13} />} sx={btnSx} onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <ToolbarTooltip title="Clear log">
          <IconButton size="small" onClick={() => clearLog()} sx={{ color: '#eee', p: 0.25 }}>
            <Eraser size={14} />
          </IconButton>
        </ToolbarTooltip>
        <ToolbarTooltip title="Reset counters">
          <IconButton size="small" onClick={() => resetDiag()} sx={{ color: '#eee', p: 0.25, ml: 'auto' }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>0</Typography>
          </IconButton>
        </ToolbarTooltip>
      </Box>
      <Box sx={{ mt: 0.5, height: '24dvh', overflow: 'auto', bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 0.5, p: 0.5 }}>
        {snap.log.map((e, i) => (
          <Box key={i} sx={{ whiteSpace: 'nowrap', color: e.type === 'watchdog' ? '#f66' : e.type === 'rej' ? '#fc6' : '#bbb' }}>
            {`${e.t.toFixed(0)} ${e.type} ${e.detail ? JSON.stringify(e.detail) : ''}`}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

const btnSx = {
  fontFamily: 'monospace',
  fontSize: '0.66rem',
  minWidth: 0,
  py: 0.25,
  px: 0.75,
  textTransform: 'none',
} as const;
