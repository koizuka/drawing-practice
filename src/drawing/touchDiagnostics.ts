/**
 * Touch / Apple Pencil input diagnostics recorder.
 *
 * Purpose: the "strokes suddenly stop registering, tab switch revives them"
 * bug on iPad has at least two candidate mechanisms that look identical to the
 * user — input dropped before StrokeManager (filter / pinch misdetection) vs.
 * the canvas bitmap not being presented by the iOS compositor — and the two
 * prior fixes (#166, #191) were unverified hypotheses. This module is a neutral
 * instrument: it records raw counters + a timestamped ring buffer so the real
 * mechanism can be confirmed OR refuted on the device, instead of guessing.
 *
 * Design:
 * - Off by default. Enabled only via `?diag=touch` (mirrored to localStorage so
 *   it survives the reload that often accompanies the bug). `?diag=off` clears.
 * - Hot-path writes are plain integer increments on a hoisted singleton behind
 *   a `DIAG_ENABLED` const branch — no allocation, no React re-render.
 * - The overlay polls this module at a few Hz; it never pushes to the overlay.
 *
 * To remove the whole harness once the root cause is found: delete this file
 * and TouchDiagnosticsOverlay.tsx, then grep DrawingCanvas/DrawingPanel for
 * `DIAG_ENABLED` / `diag.` / `touchDiagnostics` and strip the guarded lines.
 */

/**
 * Resolve whether diagnostics are enabled, given a query string and a storage.
 * Pure so it can be unit-tested without touching the real `location` /
 * `localStorage`. `?diag=touch` turns it on and persists; `?diag=off` clears.
 * Otherwise it falls back to the persisted flag.
 */
export function resolveEnabled(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean {
  let q: string | null;
  try {
    q = new URLSearchParams(search).get('diag');
  }
  catch {
    q = null;
  }
  if (q === 'touch') {
    try { storage.setItem('diag', 'touch'); }
    catch { /* private mode / quota — ignore */ }
    return true;
  }
  if (q === 'off') {
    try { storage.removeItem('diag'); }
    catch { /* ignore */ }
    return false;
  }
  try {
    return storage.getItem('diag') === 'touch';
  }
  catch {
    return false;
  }
}

function resolveEnabledFromEnv(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return resolveEnabled(window.location.search, window.localStorage);
  }
  catch {
    return false;
  }
}

/** Resolved once at module load. A hoisted const so guards optimize to a cheap branch. */
export const DIAG_ENABLED = resolveEnabledFromEnv();

export interface DiagCounters {
  // Input — observed on the canvas element's own listeners.
  touchstart: number;
  touchmove: number;
  touchend: number;
  touchcancel: number;
  touchTypeStylus: number;
  touchTypeDirect: number;
  touchTypeUndefined: number;
  // Rejections, by reason.
  rejInputFrozen: number;
  rejPinch: number;
  rejStylusFilterStart: number;
  rejStylusFilterMove: number;
  rejMoveAppendFalse: number;
  // Data — strokes reaching StrokeManager.
  startStroke: number;
  appendOk: number;
  appendSkip: number;
  endCommit: number;
  cancelStroke: number;
  // Render — redrawAll / rAF scheduling for redraws.
  redrawAll: number;
  rafScheduled: number;
  lastRedrawAt: number;
  heartbeat: number;
  // rAF liveness — a free-running tick independent of redraw, to tell
  // "main thread / rAF stalled" apart from "rAF runs but compositor won't present".
  rafTick: number;
  lastRafAt: number;
  // Document-level touch arrival — to detect the canvas losing its event target.
  docTouchstart: number;
  docTouchmove: number;
  docTouchend: number;
  docTouchcancel: number;
  // Cross-channel input arrival — pointer / click events observed at document
  // level. The confirmed freeze suspends *touch* delivery page-wide; if
  // pointer/click still fire during the touch-gap, a non-touch channel survives
  // (a recovery foothold). If none fire, all input is suspended. `docPointerPen`
  // counts pointer events with pointerType==='pen' (Apple Pencil, incl. hover).
  docPointerdown: number;
  docPointermove: number;
  docPointerPen: number;
  docClick: number;
  // Session reset.
  resetCount: number;
  lastResetTrigger: ResetTrigger | null;
}

export type ResetTrigger = 'blur' | 'pagehide' | 'visibility' | 'manual';

function makeCounters(): DiagCounters {
  return {
    touchstart: 0, touchmove: 0, touchend: 0, touchcancel: 0,
    touchTypeStylus: 0, touchTypeDirect: 0, touchTypeUndefined: 0,
    rejInputFrozen: 0, rejPinch: 0, rejStylusFilterStart: 0, rejStylusFilterMove: 0, rejMoveAppendFalse: 0,
    startStroke: 0, appendOk: 0, appendSkip: 0, endCommit: 0, cancelStroke: 0,
    redrawAll: 0, rafScheduled: 0, lastRedrawAt: 0, heartbeat: 0,
    rafTick: 0, lastRafAt: 0,
    docTouchstart: 0, docTouchmove: 0, docTouchend: 0, docTouchcancel: 0,
    docPointerdown: 0, docPointermove: 0, docPointerPen: 0, docClick: 0,
    resetCount: 0, lastResetTrigger: null,
  };
}

/** The live mutable counters. Mutated in place; never reassigned. */
export const diag: DiagCounters = makeCounters();

/** Reset every counter to zero (used by tests and the "Clear log" affordance). */
export function resetDiag(): void {
  Object.assign(diag, makeCounters());
}

// --- Live state probe ---------------------------------------------------------
// DrawingCanvas registers a closure that reads its own refs; the overlay pulls
// it at poll time so DrawingCanvas never re-renders to expose state.

export interface DiagState {
  hasStylus: boolean;
  activeTouchCount: number;
  activeTouchIds: number[];
  pinchActive: boolean;
  strokeCount: number;
  /** Current drawing mode — lets the watchdog ignore non-pen moves. */
  mode: string;
  /** Whether a stroke is currently in progress (currentStroke != null). */
  drawing: boolean;
}

type StateProbe = () => DiagState;
let stateProbe: StateProbe | null = null;

export function registerStateProbe(fn: StateProbe | null): void {
  stateProbe = fn;
}

export function readState(): DiagState | null {
  return stateProbe ? stateProbe() : null;
}

// --- Recovery actions ---------------------------------------------------------
// DrawingCanvas registers these so the overlay's recovery buttons can poke the
// canvas internals (reset session, clear stylus flag, force redraw, nudge the
// compositor) without prop-drilling callbacks through the panel tree.

export interface RecoveryActions {
  resetSession: () => void;
  clearStylus: () => void;
  forceRedraw: () => void;
  nudgeCompositor: () => void;
}

let recoveryActions: RecoveryActions | null = null;

export function registerRecoveryActions(actions: RecoveryActions | null): void {
  recoveryActions = actions;
}

export function getRecoveryActions(): RecoveryActions | null {
  return recoveryActions;
}

// --- Ring buffer --------------------------------------------------------------

export interface DiagLogEntry {
  t: number;
  type: string;
  detail?: Record<string, unknown>;
}

const LOG_CAP = 200;
const PERSIST_KEY = 'diag.log';
let ring: DiagLogEntry[] = [];

function nowMs(): number {
  // performance.now() is monotonic and available wherever this runs in-app.
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export function logEvent(type: string, detail?: Record<string, unknown>): void {
  ring.push({ t: nowMs(), type, detail });
  if (ring.length > LOG_CAP) ring.splice(0, ring.length - LOG_CAP);
}

export function getLog(): readonly DiagLogEntry[] {
  return ring;
}

export function clearLog(): void {
  ring = [];
  try { window.localStorage.removeItem(PERSIST_KEY); }
  catch { /* ignore */ }
}

export function serializeLog(): string {
  const header = {
    ...diag,
    state: readState(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
  return [
    '=== touchDiagnostics counters ===',
    JSON.stringify(header, null, 2),
    '=== events ===',
    ...ring.map(e => `${e.t.toFixed(0)}\t${e.type}\t${e.detail ? JSON.stringify(e.detail) : ''}`),
  ].join('\n');
}

/**
 * Persist the ring buffer so a reload after the bug keeps the pre-recovery
 * trail. Throttled by the caller (only on touchend / explicit copy), never per
 * touchmove, so it can't stall the hot path.
 */
export function persistLog(): void {
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(ring));
  }
  catch { /* quota / private mode — ignore */ }
}

function isValidLogEntry(v: unknown): v is DiagLogEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.t === 'number' && typeof e.type === 'string'
    && (e.detail === undefined || (typeof e.detail === 'object' && e.detail !== null));
}

export function loadPersistedLog(): void {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Validate each entry — a corrupted / older-format record must not crash
      // serializeLog() or the overlay (both assume t:number, type:string).
      ring = parsed.filter(isValidLogEntry).slice(-LOG_CAP);
    }
  }
  catch { /* malformed — ignore */ }
}

// Restore any persisted trail at module init so the previous session's last
// moments are visible after the reload the bug often triggers.
if (DIAG_ENABLED) {
  loadPersistedLog();
}
