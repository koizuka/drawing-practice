import { render, fireEvent, act } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import { vi } from 'vitest'
import { DrawingPanel } from './DrawingPanel'
import { GuideProvider } from '../guides/GuideContext'
import { useTimer, type TimerHandle } from '../hooks/useTimer'
import { StrokeManager } from '../drawing/StrokeManager'
import type { ReferenceSnapshot } from '../drawing/types'

vi.mock('../storage', () => ({
  saveDrawing: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../storage/generateThumbnail', () => ({
  generateThumbnail: vi.fn().mockReturnValue('data:image/png;base64,zz'),
}))
vi.mock('./Gallery', () => ({
  Gallery: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="gallery-stub">
      <button onClick={onClose}>close gallery</button>
    </div>
  ),
}))

type StubCanvasProps = {
  strokeManagerRef: React.RefObject<StrokeManager>
  onStrokeCountChange: () => void
}
const canvasPropsRef: { current: StubCanvasProps | null } = { current: null }
vi.mock('./DrawingCanvas', () => ({
  DrawingCanvas: (props: StubCanvasProps) => {
    canvasPropsRef.current = props
    return <div data-testid="drawing-canvas-stub" />
  },
}))

function snap(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
  return {
    source: 'none',
    referenceMode: 'browse',
    fixedImageUrl: null,
    localImageUrl: null,
    referenceInfo: null,
    ...overrides,
  }
}

type Harness = {
  timer: TimerHandle
  sm: StrokeManager | null
  bumpRestore: () => void
  bumpHistory: () => void
}

function setup(opts: {
  captureRef?: () => ReferenceSnapshot
  onToggleReferenceCollapsed?: () => void
  collapseLocked?: boolean
} = {}) {
  const harness: Harness = {
    timer: null as unknown as TimerHandle,
    sm: null,
    bumpRestore: () => {},
    bumpHistory: () => {},
  }

  function Inner({ children }: { children: (h: { timer: TimerHandle; restoreVersion: number; historySyncVersion: number }) => ReactNode }) {
    const timer = useTimer()
    const [restoreVersion, setRestoreVersion] = useState(0)
    const [historySyncVersion, setHistorySyncVersion] = useState(0)

    // Mirror handles into the external harness object via effects so the
    // react-hooks/immutability lint rule is satisfied (mutating outside state
    // during render is disallowed). Effects run after commit, and act() waits
    // for them before returning, so the test always sees the latest values.
    useEffect(() => {
      harness.timer = timer
    })
    useEffect(() => {
      harness.bumpRestore = () => setRestoreVersion(v => v + 1)
      harness.bumpHistory = () => setHistorySyncVersion(v => v + 1)
    }, [])

    return <>{children({ timer, restoreVersion, historySyncVersion })}</>
  }

  const utils = render(
    <GuideProvider>
      <Inner>
        {({ timer, restoreVersion, historySyncVersion }) => (
          <DrawingPanel
            timer={timer}
            onStrokeManagerReady={sm => {
              harness.sm = sm
            }}
            restoreVersion={restoreVersion}
            historySyncVersion={historySyncVersion}
            captureReferenceSnapshot={opts.captureRef}
            onToggleReferenceCollapsed={opts.onToggleReferenceCollapsed}
            collapseLocked={opts.collapseLocked}
          />
        )}
      </Inner>
    </GuideProvider>,
  )

  return { ...utils, harness }
}

function findIconButton(container: HTMLElement, iconClass: string): HTMLButtonElement {
  const icon = container.querySelector(`svg.${iconClass}`)
  if (!icon) throw new Error(`icon ${iconClass} not found`)
  const button = icon.closest('button')
  if (!button) throw new Error(`no button wraps ${iconClass}`)
  return button as HTMLButtonElement
}

function addStroke(sm: StrokeManager, x: number, y: number) {
  sm.startStroke({ x, y })
  sm.appendStroke({ x: x + 10, y: y + 10 })
  sm.endStroke()
}

describe('DrawingPanel undo/redo × timer integration', () => {
  beforeEach(() => {
    canvasPropsRef.current = null
  })

  it('resets timer when undo drains the history stack', () => {
    const { container, harness } = setup()

    // Draw one stroke; notify DrawingPanel via the canvas stub's callback so
    // handleStrokeCountChange runs (syncs UI + auto-starts timer).
    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
    })

    expect(harness.timer.isRunning).toBe(true)
    const undoBtn = findIconButton(container, 'lucide-undo-2')
    expect(undoBtn).not.toBeDisabled()

    act(() => {
      fireEvent.click(undoBtn)
    })

    expect(harness.sm!.canUndo()).toBe(false)
    expect(harness.timer.isRunning).toBe(false)
    expect(harness.timer.elapsedMs).toBe(0)
  })

  it('does not reset timer when undo only pops a reference entry (strokes remain)', () => {
    const { container, harness } = setup({ captureRef: () => snap({ source: 'image' }) })

    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
      // Parent (SplitLayout) would call recordReferenceChange + bumpHistory for
      // a reference edit. Simulate that here.
      harness.sm!.recordReferenceChange(snap({ source: 'none' }))
      harness.bumpHistory()
    })

    expect(harness.timer.isRunning).toBe(true)

    // First undo pops the reference entry — stroke entry still on the stack.
    const undoBtn = findIconButton(container, 'lucide-undo-2')
    act(() => {
      fireEvent.click(undoBtn)
    })

    expect(harness.sm!.canUndo()).toBe(true) // stroke entry remains
    expect(harness.timer.isRunning).toBe(true)
    expect(harness.timer.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('auto-starts timer on redo when strokes are restored from an emptied stack', () => {
    const { container, harness } = setup()

    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
    })
    act(() => {
      fireEvent.click(findIconButton(container, 'lucide-undo-2'))
    })
    expect(harness.timer.isRunning).toBe(false)
    expect(harness.timer.elapsedMs).toBe(0)

    const redoBtn = findIconButton(container, 'lucide-redo-2')
    expect(redoBtn).not.toBeDisabled()

    act(() => {
      fireEvent.click(redoBtn)
    })

    expect(harness.sm!.getStrokes()).toHaveLength(1)
    expect(harness.timer.isRunning).toBe(true)
  })

  it('does not touch the timer when eraser (deleteStroke) removes all strokes', () => {
    const { harness } = setup()

    act(() => {
      addStroke(harness.sm!, 0, 0)
      addStroke(harness.sm!, 100, 100)
      canvasPropsRef.current!.onStrokeCountChange()
    })

    expect(harness.timer.isRunning).toBe(true)
    const runningBeforeErase = harness.timer.isRunning

    // Simulate eraser deleting both strokes via the manager directly.
    act(() => {
      harness.sm!.deleteStroke(0)
      harness.sm!.deleteStroke(0)
      // DrawingCanvas would normally call this after eraser deletes.
      canvasPropsRef.current!.onStrokeCountChange()
    })

    expect(harness.sm!.getStrokes()).toHaveLength(0)
    // Timer keeps running — eraser intentionally does not reset.
    expect(harness.timer.isRunning).toBe(runningBeforeErase)
  })
})

describe('DrawingPanel toolbar state', () => {
  beforeEach(() => {
    canvasPropsRef.current = null
  })

  it('disables the clear button when there are no strokes, enables it after drawing', () => {
    const { container, harness } = setup()

    const clearBtn = findIconButton(container, 'lucide-trash-2')
    expect(clearBtn).toBeDisabled()

    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
    })

    expect(clearBtn).not.toBeDisabled()
  })

  it('clear button resets the timer and clears the strokes', () => {
    const { container, harness } = setup()

    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
    })
    expect(harness.timer.isRunning).toBe(true)

    const clearBtn = findIconButton(container, 'lucide-trash-2')
    act(() => {
      fireEvent.click(clearBtn)
    })

    expect(harness.sm!.getStrokes()).toHaveLength(0)
    expect(harness.timer.isRunning).toBe(false)
    expect(harness.timer.elapsedMs).toBe(0)
  })
})

describe('DrawingPanel keyboard shortcuts × Gallery', () => {
  beforeEach(() => {
    canvasPropsRef.current = null
  })

  function fireKey(opts: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts })
    document.dispatchEvent(event)
  }

  it('suppresses Ctrl+Z undo while Gallery is open, and re-enables it on close', () => {
    const { container, harness, getByTestId, queryByTestId } = setup()

    // Arrange: one stroke on the manager, timer started via canvas callback.
    act(() => {
      addStroke(harness.sm!, 0, 0)
      canvasPropsRef.current!.onStrokeCountChange()
    })
    expect(harness.sm!.getStrokes()).toHaveLength(1)

    // Open Gallery (clicking the gallery IconButton also pauses the timer).
    const galleryBtn = findIconButton(container, 'lucide-images')
    act(() => {
      fireEvent.click(galleryBtn)
    })
    expect(getByTestId('gallery-stub')).toBeInTheDocument()
    expect(harness.timer.isRunning).toBe(false)

    // Ctrl+Z should be ignored — stroke stays.
    act(() => {
      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true })
    })
    expect(harness.sm!.getStrokes()).toHaveLength(1)

    // Close Gallery via the stub's button.
    act(() => {
      fireEvent.click(getByTestId('gallery-stub').querySelector('button')!)
    })
    expect(queryByTestId('gallery-stub')).not.toBeInTheDocument()

    // Now Ctrl+Z should undo.
    act(() => {
      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true })
    })
    expect(harness.sm!.getStrokes()).toHaveLength(0)
  })
})

describe('DrawingPanel collapse toggle', () => {
  beforeEach(() => {
    canvasPropsRef.current = null
  })

  // The collapse toggle has 3 states (no-handler / enabled / disabled-locked).
  // The icon class is shared between collapsed and expanded variants of the
  // button (PanelLeftClose vs PanelLeftOpen) and there's no text label, so we
  // grep by aria-label, which mirrors the tooltip text.
  function findCollapseButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button[aria-label*="reference"i], button[aria-label*="angle"i]')
  }

  it('omits the collapse button when no toggle handler is provided', () => {
    const { container } = setup()
    expect(findCollapseButton(container)).toBeNull()
  })

  it('renders an enabled collapse button with the expand/collapse tooltip', () => {
    const onToggle = vi.fn()
    const { container } = setup({ onToggleReferenceCollapsed: onToggle })
    const btn = findCollapseButton(container)
    expect(btn).not.toBeNull()
    expect(btn).not.toBeDisabled()
    // Default referenceCollapsed=false -> "collapse" tooltip
    expect(btn!.getAttribute('aria-label')).toMatch(/Hide reference/i)

    fireEvent.click(btn!)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('disables the collapse button and shows the locked tooltip when collapseLocked', () => {
    const onToggle = vi.fn()
    const { container } = setup({
      onToggleReferenceCollapsed: onToggle,
      collapseLocked: true,
    })
    const btn = findCollapseButton(container)
    expect(btn).not.toBeNull()
    expect(btn).toBeDisabled()
    expect(btn!.getAttribute('aria-label')).toMatch(/Fix the angle first/i)

    // Disabled buttons should not fire onClick. Use fireEvent — disabled MUI
    // IconButtons swallow the event natively.
    fireEvent.click(btn!)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
