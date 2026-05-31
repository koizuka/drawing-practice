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
// Freeze auto-detection: input silent for longer than this, while a streak of at
// least FREEZE_MIN_STREAK_MS was active and rAF stayed alive, is flagged as a
// (suspected) freeze episode. The gap floor is above a normal reposition pause;
// the streak floor avoids flagging an idle-at-rest as a freeze.
const FREEZE_GAP_MS = 1500;
const FREEZE_MIN_STREAK_MS = 2000;

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
  // Live freeze state, mirrored from the detector refs each poll so the HUD can
  // show "FROZEN {age}s" *during* the episode (the count only ticks up after
  // recovery, which is too late to watch).
  const [freezeLive, setFreezeLive] = useState<{ on: boolean; sinceMs: number }>({ on: false, sinceMs: 0 });

  // Previous tick's counters, for the watchdog's delta detection.
  const prevRef = useRef<typeof diag>({ ...diag });
  // Latch so each stuck episode is logged once at onset, not every tick.
  const stuckRef = useRef(false);
  // 1Hz activity-gated timeline: counters at the last second-boundary snapshot,
  // plus a tick counter. Lets us reconstruct the freeze window even when the
  // user recovers (tab switch) before reading the live counters.
  const secRef = useRef<typeof diag>({ ...diag });
  const tickCountRef = useRef(0);
  // Freeze auto-detection state. (0-init; the poll self-corrects on the first
  // tick — useRef args must be pure, so no performance.now() / diag reads here.)
  const lastInputCountRef = useRef(0);
  const lastInputAtRef = useRef(0);
  const inFreezeRef = useRef(false);
  const freezeOnsetAtRef = useRef(0);
  const freezePreStreakRef = useRef(0);

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

      // Freeze auto-detection. Watch total input (start+move); a silent spell
      // after an active streak with rAF still alive is a (suspected) freeze.
      const inputCount = cur.touchstart + cur.touchmove;
      const rafAlive = cur.lastRafAt > 0 && (now - cur.lastRafAt) < RAF_STALL_MS;
      if (inputCount > lastInputCountRef.current) {
        if (inFreezeRef.current) {
          // Input resumed → the episode ends. Log its silent duration + the
          // streak that preceded it.
          const durationMs = Math.round(now - freezeOnsetAtRef.current);
          diag.freezeCount++;
          diag.lastFreezeMs = durationMs;
          // `open` = touchstart − touchend − touchcancel = contacts started but
          // neither ended nor canceled (lost-touchend / 664108 hypothesis: an
          // orphaned contact makes WebKit believe the Pencil is still down →
          // exclusive input lock). touchcancel must be subtracted — a canceled
          // touch DID close (it just routes to the touchcancel counter, not
          // touchend), so omitting it would misreport it as unclosed. `active` =
          // the canvas's own live-touch count. A healthy session pairs perfectly
          // (open oscillates 0↔1); open ≥ 1 lingering at recovery is the tell.
          logEvent('freeze', {
            durationMs, preStreakMs: Math.round(freezePreStreakRef.current),
            open: cur.touchstart - cur.touchend - cur.touchcancel, active: state?.activeTouchCount,
          });
          persistLog();
          inFreezeRef.current = false;
        }
        lastInputCountRef.current = inputCount;
        lastInputAtRef.current = now;
      }
      else if (!inFreezeRef.current
        && now - lastInputAtRef.current > FREEZE_GAP_MS
        && cur.drawStreakMs >= FREEZE_MIN_STREAK_MS
        && rafAlive) {
        // drawStreakMs stops updating once input goes silent, so it still holds
        // the pre-freeze streak here.
        inFreezeRef.current = true;
        freezeOnsetAtRef.current = lastInputAtRef.current;
        freezePreStreakRef.current = cur.drawStreakMs;
        // open/active at onset: was there an orphaned contact (lost touchend)
        // at the instant input went silent? See the `freeze` log comment.
        logEvent('freezeOnset', {
          preStreakMs: Math.round(cur.drawStreakMs),
          open: cur.touchstart - cur.touchend - cur.touchcancel, active: state?.activeTouchCount,
        });
        persistLog();
      }

      // 1Hz activity-gated timeline. Every ~1s, if there was touch activity in
      // the last second (or a stroke is mid-flight), log a compact counter
      // snapshot. During a freeze where the user keeps stroking the Pencil this
      // records whether move/append/redraw/raf advance or flatline — the exact
      // signal that separates input-drop (A) from compositor-stall (B) — and it
      // survives the user's recovery tab-switch. Idle seconds log nothing so the
      // 200-entry ring isn't wasted.
      if (++tickCountRef.current >= Math.round(1000 / POLL_MS)) {
        tickCountRef.current = 0;
        const base = secRef.current;
        const dStart = cur.touchstart - base.touchstart;
        const dMove = cur.touchmove - base.touchmove;
        const dDoc = cur.docTouchmove - base.docTouchmove;
        const dPtr = cur.docPointermove - base.docPointermove;
        const dPen = cur.docPointerPen - base.docPointerPen;
        // Read-and-reset the windowed peak so each tick logs that second's worst
        // touch-delivery latency — the trend that should climb before the freeze.
        const latMax = Math.round(cur.moveLatencyMax);
        diag.moveLatencyMax = 0;
        // Gate on dStart too: rapid short taps (touchstart→touchend, no move) are
        // exactly the 664108-class freeze trigger, but produce no move/pointer
        // delta and may sample state.drawing=false between contacts. Without this
        // those seconds would log nothing now that per-stroke start/end events
        // are suppressed, losing the very rate `start` is meant to carry.
        if (dStart > 0 || dMove > 0 || dDoc > 0 || dPtr > 0 || state?.drawing) {
          logEvent('tick', {
            // Per-second stroke-start count: per-stroke `start` logging is now
            // suppressed in DrawingCanvas, so the tick carries the rate instead.
            start: dStart,
            move: dMove, doc: dDoc,
            onCanvas: cur.docTouchOnCanvas - base.docTouchOnCanvas,
            append: cur.appendOk - base.appendOk,
            redraw: cur.redrawAll - base.redrawAll,
            raf: cur.rafTick - base.rafTick,
            ptr: dPtr, pen: dPen,
            latMax,
            // Running unclosed-contact count at the end of this second (canceled
            // touches subtracted — they close via the touchcancel counter). In a
            // healthy session this is 0 (between strokes) or 1 (mid-stroke); a
            // value that creeps up / never returns to 0 flags a lost touchend —
            // the suspected 664108 trigger — in the run-up to a freeze.
            open: cur.touchstart - cur.touchend - cur.touchcancel,
            mode: state?.mode,
          });
        }
        secRef.current = { ...cur };
      }

      setFreezeLive(inFreezeRef.current
        ? { on: true, sinceMs: now - freezeOnsetAtRef.current }
        : { on: false, sinceMs: 0 });

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

  if (collapsed) {
    return (
      <Box
        sx={{
          // absolute = DrawingPanel(position:relative)基準。fixed だと別タブ
          // 警告バナーでツールバー/キャンバスが下にずれた分を追従できない。
          // top: 84 = ツールバー(高さ40px)の下、さらにトレーススコア表示
          // (キャンバス内 top:8 の「なぞり済み」オーバーレイ ≒ パネル上端から 48〜76px)
          // も避けた位置。
          position: 'absolute', top: 84, right: 8, zIndex: 1100,
          bgcolor: 'rgba(0,0,0,0.75)', color: '#0f0', borderRadius: 1,
          px: 1, py: 0.25, fontFamily: 'monospace', fontSize: '0.7rem',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex', alignItems: 'center', gap: 0.5,
        }}
      >
        {/* State dot: frozen=red, drawing=green, idle=grey. The monotonic
            heartbeat number was dropped — its ever-growing digits made the
            badge width oscillate. */}
        <span
          style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            backgroundColor: freezeLive.on ? '#f66' : s?.drawing ? '#6f6' : '#666',
          }}
        />
        <span style={{ minWidth: 44, color: c.freezeCount > 0 ? '#f66' : undefined }}>{`frz${c.freezeCount}`}</span>
        <ToolbarTooltip title="Expand diagnostics">
          <IconButton size="small" onClick={() => setCollapsed(false)} sx={{ color: '#0f0', p: 0.25 }}>
            <Maximize2 size={14} />
          </IconButton>
        </ToolbarTooltip>
      </Box>
    );
  }

  // Each row is forced to a single line: when a value's digit count grew, the
  // label+value used to wrap inside the fixed-width panel, changing the row
  // height and making the rows below jump. The label truncates (ellipsis) and
  // the value never wraps, so row height is constant regardless of magnitude.
  const row = (label: string, value: ReactNode, color?: string) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, color: color ?? 'inherit', whiteSpace: 'nowrap' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ flexShrink: 0 }}>{value}</span>
    </Box>
  );

  const sectionSx = { mt: 0.5, pt: 0.5, borderTop: '1px solid rgba(255,255,255,0.2)' } as const;

  return (
    <Box
      sx={{
        // absolute = DrawingPanel(position:relative)基準。fixed だと別タブ
        // 警告バナーでツールバー/キャンバスが下にずれた分を追従できない。
        // top: 84 = ツールバー(高さ40px)の下、トレーススコア表示も避けた位置
        // （畳んだ状態も同様）。
        position: 'absolute', top: 84, right: 8, zIndex: 1100,
        width: 280, maxHeight: '80dvh',
        display: 'flex', flexDirection: 'column',
        bgcolor: 'rgba(0,0,0,0.82)', color: '#eee', borderRadius: 1,
        fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.45,
        fontVariantNumeric: 'tabular-nums',
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

      {/* Live signals a human watches during a freeze. Everything else lives in
          the Copy output (serializeLog dumps every counter + the event log), so
          the on-screen HUD stays small and readable — no scrolling to find the
          value under investigation. */}
      <Box sx={{ ...sectionSx, fontSize: '0.82rem', fontWeight: 700 }}>
        {freezeLive.on && row('▲ FROZEN (s)', (freezeLive.sinceMs / 1000).toFixed(1), '#f66')}
        {row('draw streak (s) / max', `${(c.drawStreakMs / 1000).toFixed(1)} / ${(c.maxDrawStreakMs / 1000).toFixed(1)}`)}
        {row('freezes / last (ms)', `${c.freezeCount} / ${c.lastFreezeMs}`, c.freezeCount > 0 ? '#f66' : '#9f9')}
        {row('mode / draw', s ? `${s.mode} / ${s.drawing}` : '?')}
        {/* open = touchstart − touchend − touchcancel (unclosed contacts). >1 is
            anomalous — the lost-touchend / exclusive-lock suspect. active = canvas live touches. */}
        {row('open / active', `${c.touchstart - c.touchend - c.touchcancel} / ${s ? s.activeTouchCount : '?'}`,
          (c.touchstart - c.touchend - c.touchcancel) > 1 ? '#f66' : undefined)}
        {row('last redraw / rAF (ms)', `${redrawAge} / ${rafAge}`,
          (redrawAge > REDRAW_STALL_MS || rafAge > RAF_STALL_MS) ? '#f66' : undefined)}
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
      <Box sx={{ mt: 0.5, height: '18dvh', overflow: 'auto', bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 0.5, p: 0.5 }}>
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
