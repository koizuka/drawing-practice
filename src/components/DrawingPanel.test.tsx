import { render, fireEvent, act } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import { DrawingPanel } from './DrawingPanel';
import { GuideProvider } from '../guides/GuideContext';
import { useTimer, type TimerHandle } from '../hooks/useTimer';
import { StrokeManager } from '../drawing/StrokeManager';
import type { ReferenceSnapshot } from '../drawing/types';

vi.mock('../storage', () => ({
  saveDrawing: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../storage/generateThumbnail', () => ({
  generateThumbnail: vi.fn().mockReturnValue('data:image/png;base64,zz'),
}));
vi.mock('./Gallery', () => ({
  Gallery: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="gallery-stub">
      <button onClick={onClose}>close gallery</button>
    </div>
  ),
}));

type StubCanvasProps = {
  strokeManager: StrokeManager;
  onStrokeCountChange: (info?: { flush?: boolean }) => void;
  onStrokeStart?: () => void;
  redrawVersion: number;
  strokeEditVersion?: number;
};
const canvasPropsRef: { current: StubCanvasProps | null } = { current: null };
vi.mock('./DrawingCanvas', () => ({
  DrawingCanvas: (props: StubCanvasProps) => {
    canvasPropsRef.current = props;
    return <div data-testid="drawing-canvas-stub" />;
  },
}));

function snap(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
  return {
    source: 'none',
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: null,
    ...overrides,
  };
}

type Harness = {
  timer: TimerHandle;
  sm: StrokeManager | null;
  bumpRestore: () => void;
  bumpHistory: () => void;
  setReferenceCollapsed: (v: boolean) => void;
};

function setup(opts: {
  captureRef?: () => ReferenceSnapshot;
  onToggleReferenceCollapsed?: () => void;
  collapseLocked?: boolean;
  initialReferenceCollapsed?: boolean;
  templateStrokes?: readonly import('../trace/types').TraceStroke[] | null;
  onTraceResetScores?: () => void;
  onStrokesChanged?: (opts?: { flush?: boolean }) => void;
  traceTotalCovered?: number;
  traceTotalStrokes?: number;
  traceOverallBestPct?: number | null;
} = {}) {
  const sm = new StrokeManager();
  const harness: Harness = {
    timer: null as unknown as TimerHandle,
    sm,
    bumpRestore: () => {},
    bumpHistory: () => {},
    setReferenceCollapsed: () => {},
  };

  function Inner({ children }: { children: (h: { timer: TimerHandle; restoreVersion: number; historySyncVersion: number; referenceCollapsed: boolean }) => ReactNode }) {
    const timer = useTimer();
    const [restoreVersion, setRestoreVersion] = useState(0);
    const [historySyncVersion, setHistorySyncVersion] = useState(0);
    const [referenceCollapsed, setReferenceCollapsed] = useState(opts.initialReferenceCollapsed ?? false);

    // Mirror handles into the external harness object via effects so the
    // react-hooks/immutability lint rule is satisfied (mutating outside state
    // during render is disallowed). Effects run after commit, and act() waits
    // for them before returning, so the test always sees the latest values.
    useEffect(() => {
      harness.timer = timer;
    });
    useEffect(() => {
      harness.bumpRestore = () => setRestoreVersion(v => v + 1);
      harness.bumpHistory = () => setHistorySyncVersion(v => v + 1);
      harness.setReferenceCollapsed = (v: boolean) => setReferenceCollapsed(v);
    }, []);

    return <>{children({ timer, restoreVersion, historySyncVersion, referenceCollapsed })}</>;
  }

  const utils = render(
    <GuideProvider>
      <Inner>
        {({ timer, restoreVersion, historySyncVersion, referenceCollapsed }) => (
          <DrawingPanel
            timer={timer}
            strokeManager={sm}
            restoreVersion={restoreVersion}
            historySyncVersion={historySyncVersion}
            captureReferenceSnapshot={opts.captureRef}
            onStrokesChanged={opts.onStrokesChanged}
            onToggleReferenceCollapsed={opts.onToggleReferenceCollapsed}
            collapseLocked={opts.collapseLocked}
            referenceCollapsed={referenceCollapsed}
            templateStrokes={opts.templateStrokes ?? null}
            onTraceResetScores={opts.onTraceResetScores}
            traceTotalCovered={opts.traceTotalCovered}
            traceTotalStrokes={opts.traceTotalStrokes}
            traceOverallBestPct={opts.traceOverallBestPct ?? null}
          />
        )}
      </Inner>
    </GuideProvider>,
  );

  return { ...utils, harness };
}

function findIconButton(container: HTMLElement, iconClass: string): HTMLButtonElement {
  const icon = container.querySelector(`svg.${iconClass}`);
  if (!icon) throw new Error(`icon ${iconClass} not found`);
  const button = icon.closest('button');
  if (!button) throw new Error(`no button wraps ${iconClass}`);
  return button as HTMLButtonElement;
}

function addStroke(sm: StrokeManager, x: number, y: number) {
  sm.startStroke({ x, y });
  sm.appendStroke({ x: x + 10, y: y + 10 });
  sm.endStroke();
}

describe('DrawingPanel autosave flush on discrete edits', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  // Notify the panel via the canvas stub so handleStrokeCountChange re-renders
  // it (enabling the undo/redo/trash buttons), mirroring a real stroke commit.
  function drawAndNotify(harness: Harness) {
    addStroke(harness.sm!, 0, 0);
    canvasPropsRef.current!.onStrokeCountChange();
  }

  it('undo flushes autosave immediately (flush: true)', () => {
    const onStrokesChanged = vi.fn();
    const { container, harness } = setup({ onStrokesChanged });
    act(() => {
      drawAndNotify(harness);
    });
    onStrokesChanged.mockClear();
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-undo-2'));
    });
    expect(onStrokesChanged).toHaveBeenCalledWith({ flush: true });
  });

  it('redo flushes autosave immediately (flush: true)', () => {
    const onStrokesChanged = vi.fn();
    const { container, harness } = setup({ onStrokesChanged });
    act(() => {
      drawAndNotify(harness);
    });
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-undo-2'));
    });
    onStrokesChanged.mockClear();
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-redo-2'));
    });
    expect(onStrokesChanged).toHaveBeenCalledWith({ flush: true });
  });

  it('clear (trash) flushes autosave immediately (flush: true)', () => {
    const onStrokesChanged = vi.fn();
    const { container, harness } = setup({ onStrokesChanged });
    act(() => {
      drawAndNotify(harness);
    });
    onStrokesChanged.mockClear();
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-trash-2'));
    });
    expect(onStrokesChanged).toHaveBeenCalledWith({ flush: true });
  });

  it('a lasso-delete commit forwards flush so the erase persists immediately', () => {
    const onStrokesChanged = vi.fn();
    const { harness } = setup({ onStrokesChanged });
    act(() => {
      addStroke(harness.sm!, 0, 0);
    });
    onStrokesChanged.mockClear();
    // DrawingCanvas signals a discrete erase with `flush: true`.
    act(() => {
      canvasPropsRef.current!.onStrokeCountChange({ flush: true });
    });
    expect(onStrokesChanged).toHaveBeenCalledWith({ flush: true });
  });

  it('a freehand stroke commit stays on the 2s debounce (no flush flag)', () => {
    const onStrokesChanged = vi.fn();
    const { harness } = setup({ onStrokesChanged });
    act(() => {
      addStroke(harness.sm!, 0, 0);
    });
    onStrokesChanged.mockClear();
    // A plain stroke commit omits `flush` — it should ride the debounce path.
    act(() => {
      canvasPropsRef.current!.onStrokeCountChange();
    });
    expect(onStrokesChanged).toHaveBeenCalledWith(undefined);
  });
});

describe('DrawingPanel undo/redo × timer integration', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  it('resets timer when undo drains the history stack', () => {
    const { container, harness } = setup();

    // Draw one stroke; notify DrawingPanel via the canvas stub's callback so
    // handleStrokeCountChange runs (syncs UI + auto-starts timer).
    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    expect(harness.timer.isRunning).toBe(true);
    const undoBtn = findIconButton(container, 'lucide-undo-2');
    expect(undoBtn).not.toBeDisabled();

    act(() => {
      fireEvent.click(undoBtn);
    });

    expect(harness.sm!.canUndo()).toBe(false);
    expect(harness.timer.isRunning).toBe(false);
    expect(harness.timer.elapsedMs).toBe(0);
  });

  it('does not reset timer when undo only pops a reference entry (strokes remain)', () => {
    const { container, harness } = setup({ captureRef: () => snap({ source: 'image' }) });

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
      // Parent (SplitLayout) would call recordReferenceChange + bumpHistory for
      // a reference edit. Simulate that here.
      harness.sm!.recordReferenceChange(snap({ source: 'none' }));
      harness.bumpHistory();
    });

    expect(harness.timer.isRunning).toBe(true);

    // First undo pops the reference entry — stroke entry still on the stack.
    const undoBtn = findIconButton(container, 'lucide-undo-2');
    act(() => {
      fireEvent.click(undoBtn);
    });

    expect(harness.sm!.canUndo()).toBe(true); // stroke entry remains
    expect(harness.timer.isRunning).toBe(true);
    expect(harness.timer.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('auto-starts timer on redo when strokes are restored from an emptied stack', () => {
    const { container, harness } = setup();

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-undo-2'));
    });
    expect(harness.timer.isRunning).toBe(false);
    expect(harness.timer.elapsedMs).toBe(0);

    const redoBtn = findIconButton(container, 'lucide-redo-2');
    expect(redoBtn).not.toBeDisabled();

    act(() => {
      fireEvent.click(redoBtn);
    });

    expect(harness.sm!.getStrokes()).toHaveLength(1);
    expect(harness.timer.isRunning).toBe(true);
  });

  it('does not touch the timer when eraser (deleteStroke) removes all strokes', () => {
    const { harness } = setup();

    act(() => {
      addStroke(harness.sm!, 0, 0);
      addStroke(harness.sm!, 100, 100);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    expect(harness.timer.isRunning).toBe(true);
    const runningBeforeErase = harness.timer.isRunning;

    // Simulate eraser deleting both strokes via the manager directly.
    act(() => {
      harness.sm!.deleteStroke(0);
      harness.sm!.deleteStroke(0);
      // DrawingCanvas would normally call this after eraser deletes.
      canvasPropsRef.current!.onStrokeCountChange();
    });

    expect(harness.sm!.getStrokes()).toHaveLength(0);
    // Timer keeps running — eraser intentionally does not reset.
    expect(harness.timer.isRunning).toBe(runningBeforeErase);
  });
});

describe('DrawingPanel toolbar state', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  it('disables the clear button when there are no strokes, enables it after drawing', () => {
    const { container, harness } = setup();

    const clearBtn = findIconButton(container, 'lucide-trash-2');
    expect(clearBtn).toBeDisabled();

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    expect(clearBtn).not.toBeDisabled();
  });

  it('clear button is tentative: hides strokes, pauses timer (does NOT reset), and Undo restores both', () => {
    const { container, harness } = setup();

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });
    expect(harness.timer.isRunning).toBe(true);
    // Use restore() to set a deterministic elapsed value (real time would
    // tick between capture and assert, making equality flaky).
    act(() => {
      harness.timer.restore(2_500);
    });

    const clearBtn = findIconButton(container, 'lucide-trash-2');
    act(() => {
      fireEvent.click(clearBtn);
    });

    expect(harness.sm!.getStrokes()).toHaveLength(0);
    expect(harness.sm!.isTentativeClearActive()).toBe(true);
    expect(harness.timer.isRunning).toBe(false);
    // Elapsed time is preserved — Undo will restore strokes alongside the timer reading.
    expect(harness.timer.elapsedMs).toBe(2_500);
    expect(harness.sm!.canUndo()).toBe(true);

    // Undo restores the strokes; timer stays paused with the same elapsed value.
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-undo-2'));
    });
    expect(harness.sm!.getStrokes()).toHaveLength(1);
    expect(harness.sm!.isTentativeClearActive()).toBe(false);
    expect(harness.timer.elapsedMs).toBe(2_500);
  });

  it('drawing after a tentative clear resets the timer at stroke START (pen-down), not on release', () => {
    const { container, harness } = setup();

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });
    // Simulate accumulated elapsed time so we can observe the reset.
    act(() => {
      harness.timer.restore(5_000);
    });

    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-trash-2'));
    });
    expect(harness.sm!.isTentativeClearActive()).toBe(true);
    expect(harness.timer.elapsedMs).toBe(5_000);
    expect(harness.timer.isRunning).toBe(false);

    // Pen touches down: DrawingCanvas fires onStrokeStart. With a tentative
    // clear active this resets the timer to 0 and starts counting immediately —
    // a long opening stroke is now timed, instead of resetting only on release.
    act(() => {
      canvasPropsRef.current!.onStrokeStart?.();
    });
    expect(harness.timer.elapsedMs).toBe(0);
    expect(harness.timer.isRunning).toBe(true);
    // Still tentative until the stroke commits.
    expect(harness.sm!.isTentativeClearActive()).toBe(true);

    // Pen lifts: the stroke commits the tentative clear. The release path must
    // NOT re-reset the already-running timer.
    act(() => {
      addStroke(harness.sm!, 100, 100);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    expect(harness.sm!.getStrokes()).toHaveLength(1);
    expect(harness.sm!.isTentativeClearActive()).toBe(false);
    expect(harness.timer.elapsedMs).toBe(0);
    expect(harness.timer.isRunning).toBe(true);
  });

  it('starts the timer at stroke START on a fresh canvas (does not wait for release)', () => {
    const { harness } = setup();

    expect(harness.timer.isRunning).toBe(false);

    // Pen touches down on an empty canvas — timer should begin counting now,
    // so the first (possibly long) stroke is timed.
    act(() => {
      canvasPropsRef.current!.onStrokeStart?.();
    });
    expect(harness.timer.isRunning).toBe(true);
    expect(harness.timer.elapsedMs).toBe(0);
  });

  it('resume-after-pause: stroke START resumes WITHOUT resetting when merely paused (no tentative clear)', () => {
    const { harness } = setup();

    // Draw, then simulate a non-tentative pause (e.g. Save / open gallery /
    // reference change that left strokes intact) with accumulated elapsed.
    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });
    act(() => {
      harness.timer.restore(2_500);
    });
    expect(harness.timer.isRunning).toBe(false);
    expect(harness.sm!.isTentativeClearActive()).toBe(false);

    // Pen-down on the next stroke must RESUME from the accumulated reading, not
    // zero it — the tentative-clear reset guard must not fire here.
    act(() => {
      canvasPropsRef.current!.onStrokeStart?.();
    });
    expect(harness.timer.isRunning).toBe(true);
    expect(harness.timer.elapsedMs).toBe(2_500);
  });

  it('clear button also resets trace scores so leftover red feedback bands do not outlive the strokes', () => {
    // Regression: previously handleClear wiped strokes/timer but left the
    // scoring context's latestFeedback in place, so the red deviation bands
    // from the last attempt kept rendering after the user blew away the
    // strokes that produced them.
    const onTraceResetScores = vi.fn();
    const { container, harness } = setup({
      onTraceResetScores,
      templateStrokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], length: 10, closed: false }],
      traceTotalCovered: 1,
      traceTotalStrokes: 1,
      traceOverallBestPct: 0.5,
    });

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    const clearBtn = findIconButton(container, 'lucide-trash-2');
    act(() => {
      fireEvent.click(clearBtn);
    });

    expect(onTraceResetScores).toHaveBeenCalledTimes(1);
  });

  it('handleClear runs onTraceResetScores BEFORE tentativeClear so discardStrokes can prune scored strokes from the clear entry', () => {
    // Regression: if reset runs AFTER tentativeClear, discardStrokes
    // early-returns on strokes.length===0 and the scored strokes survive
    // inside the `'clear'` undo entry. Undo would resurrect them as
    // untracked ghosts AND attemptMap is already wiped — a follow-up
    // re-trace cannot replace them, leaving permanent duplicates.
    // Verify the ordering by inspecting the StrokeManager state inside the
    // reset callback: it must observe the strokes still present.
    let strokesAtResetTime: number | null = null;
    const { container, harness } = setup({
      onTraceResetScores: () => {
        strokesAtResetTime = harness.sm!.getStrokes().length;
      },
      templateStrokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], length: 10, closed: false }],
      traceTotalCovered: 1,
      traceTotalStrokes: 1,
      traceOverallBestPct: 0.5,
    });

    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });

    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-trash-2'));
    });

    expect(strokesAtResetTime).toBe(1);
  });
});

describe('DrawingPanel keyboard shortcuts × Gallery', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  function fireKey(opts: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(event);
  }

  it('suppresses Ctrl+Z undo while Gallery is open, and re-enables it on close', async () => {
    const { container, harness, findByTestId, queryByTestId } = setup();

    // Arrange: one stroke on the manager, timer started via canvas callback.
    act(() => {
      addStroke(harness.sm!, 0, 0);
      canvasPropsRef.current!.onStrokeCountChange();
    });
    expect(harness.sm!.getStrokes()).toHaveLength(1);

    // Open Gallery (clicking the gallery IconButton also pauses the timer).
    const galleryBtn = findIconButton(container, 'lucide-images');
    act(() => {
      fireEvent.click(galleryBtn);
    });
    // Gallery is lazy-loaded; await the Suspense to resolve to the stub.
    const galleryStub = await findByTestId('gallery-stub');
    expect(galleryStub).toBeInTheDocument();
    expect(harness.timer.isRunning).toBe(false);

    // Ctrl+Z should be ignored — stroke stays.
    act(() => {
      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true });
    });
    expect(harness.sm!.getStrokes()).toHaveLength(1);

    // Close Gallery via the stub's button.
    act(() => {
      fireEvent.click(galleryStub.querySelector('button')!);
    });
    expect(queryByTestId('gallery-stub')).not.toBeInTheDocument();

    // Now Ctrl+Z should undo.
    act(() => {
      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true });
    });
    expect(harness.sm!.getStrokes()).toHaveLength(0);
  });
});

describe('DrawingPanel collapse toggle', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  // The collapse toggle has 3 states (no-handler / enabled / disabled-locked).
  // The icon class is shared between collapsed and expanded variants of the
  // button (PanelLeftClose vs PanelLeftOpen) and there's no text label, so we
  // grep by aria-label, which mirrors the tooltip text.
  function findCollapseButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button[aria-label*="reference"i], button[aria-label*="angle"i]');
  }

  it('omits the collapse button when no toggle handler is provided', () => {
    const { container } = setup();
    expect(findCollapseButton(container)).toBeNull();
  });

  it('renders an enabled collapse button with the expand/collapse tooltip', () => {
    const onToggle = vi.fn();
    const { container } = setup({ onToggleReferenceCollapsed: onToggle });
    const btn = findCollapseButton(container);
    expect(btn).not.toBeNull();
    expect(btn).not.toBeDisabled();
    // Default referenceCollapsed=false -> "collapse" tooltip
    expect(btn!.getAttribute('aria-label')).toMatch(/Hide reference/i);

    fireEvent.click(btn!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables the collapse button and shows the locked tooltip when collapseLocked', () => {
    const onToggle = vi.fn();
    const { container } = setup({
      onToggleReferenceCollapsed: onToggle,
      collapseLocked: true,
    });
    const btn = findCollapseButton(container);
    expect(btn).not.toBeNull();
    expect(btn).toBeDisabled();
    expect(btn!.getAttribute('aria-label')).toMatch(/Fix the angle first/i);

    // Disabled buttons should not fire onClick. Use fireEvent — disabled MUI
    // IconButtons swallow the event natively.
    fireEvent.click(btn!);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // The FLIP animation only runs when the user clicks the toggle; a
  // referenceCollapsed change driven by draft-restore (or any other parent
  // state path) must NOT animate, otherwise reload would briefly slide the
  // toolbar across the viewport for no reason. The implementation gates the
  // useLayoutEffect on a pendingFlipRef populated only by the click handler.
  it('does not write FLIP transform styles when referenceCollapsed flips without a click', () => {
    const onToggle = vi.fn();
    const { container, harness } = setup({
      onToggleReferenceCollapsed: onToggle,
      initialReferenceCollapsed: false,
    });

    const toolbar = container.querySelector<HTMLDivElement>('button[aria-label*="reference"i]')!.closest('div')!;
    expect(toolbar).not.toBeNull();

    act(() => {
      harness.setReferenceCollapsed(true);
    });

    // No click happened, so no element inside the toolbar should have an
    // inline transform applied by the FLIP effect.
    const elementsWithTransform = Array.from(toolbar.querySelectorAll('*')).filter(
      el => (el as HTMLElement).style.transform !== '',
    );
    expect(elementsWithTransform).toHaveLength(0);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

// The input-freeze hint resets its continuous-draw streak when DrawingCanvas
// sees strokeEditVersion change. That signal MUST bump only on discrete edits
// (undo/redo/clear/delete), never on freehand commits — otherwise the streak
// resets after every stroke and the hint can never become eligible in the
// many-short-strokes pattern. (Regression guard: a previous version keyed the
// reset on redrawVersion, which also bumps on every commit, silently disabling
// the hint.)
describe('DrawingPanel freeze-hint streak signal (strokeEditVersion)', () => {
  beforeEach(() => {
    canvasPropsRef.current = null;
  });

  function drawAndNotify(harness: Harness) {
    addStroke(harness.sm!, 0, 0);
    canvasPropsRef.current!.onStrokeCountChange();
  }

  it('does NOT bump strokeEditVersion on freehand stroke commits', () => {
    const { harness } = setup();
    const editV0 = canvasPropsRef.current!.strokeEditVersion;
    const redrawV0 = canvasPropsRef.current!.redrawVersion;

    act(() => { drawAndNotify(harness); });
    act(() => { drawAndNotify(harness); });
    act(() => { drawAndNotify(harness); });

    // Freehand commits must leave the freeze-streak signal untouched...
    expect(canvasPropsRef.current!.strokeEditVersion).toBe(editV0);
    // ...even though redrawVersion does advance on each commit (the trap that
    // the earlier redrawVersion-keyed reset fell into).
    expect(canvasPropsRef.current!.redrawVersion).toBeGreaterThan(redrawV0);
  });

  it('bumps strokeEditVersion on a discrete edit (clear) so the streak resets around a button press', () => {
    const { container, harness } = setup();
    act(() => { drawAndNotify(harness); }); // enable the trash button
    const editV = canvasPropsRef.current!.strokeEditVersion ?? 0;

    act(() => { fireEvent.click(findIconButton(container, 'lucide-trash-2')); });

    expect(canvasPropsRef.current!.strokeEditVersion).toBe(editV + 1);
  });
});
