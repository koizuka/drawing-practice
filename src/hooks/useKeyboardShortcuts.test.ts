import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts, getModifierPrefix } from './useKeyboardShortcuts'

function fireKey(options: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })
  document.dispatchEvent(event)
  return event
}

function createActions() {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onPenTool: vi.fn(),
    onEraserTool: vi.fn(),
    onSave: vi.fn(),
  }
}

// Use ctrlKey for tests (non-Mac platform in jsdom)
describe('useKeyboardShortcuts', () => {
  describe('Undo (Ctrl+Z)', () => {
    it('fires onUndo on Ctrl+Z', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true })
      expect(actions.onUndo).toHaveBeenCalledOnce()
    })

    it('does not fire onUndo on Ctrl+Shift+Z', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true })
      expect(actions.onUndo).not.toHaveBeenCalled()
    })
  })

  describe('Redo', () => {
    it('fires onRedo on Ctrl+Shift+Z', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true })
      expect(actions.onRedo).toHaveBeenCalledOnce()
    })

    it('fires onRedo on Ctrl+Y', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyY', key: 'y', ctrlKey: true })
      expect(actions.onRedo).toHaveBeenCalledOnce()
    })
  })

  describe('Tool shortcuts', () => {
    it('fires onPenTool on P', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyP', key: 'p' })
      expect(actions.onPenTool).toHaveBeenCalledOnce()
    })

    it('fires onPenTool on B', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyB', key: 'b' })
      expect(actions.onPenTool).toHaveBeenCalledOnce()
    })

    it('fires onEraserTool on E', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyE', key: 'e' })
      expect(actions.onEraserTool).toHaveBeenCalledOnce()
    })
  })

  describe('Save (Ctrl+S)', () => {
    it('fires onSave on Ctrl+S', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyS', key: 's', ctrlKey: true })
      expect(actions.onSave).toHaveBeenCalledOnce()
    })
  })

  describe('preventDefault', () => {
    it('prevents default on Ctrl+Z', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      const event = fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true })
      expect(event.defaultPrevented).toBe(true)
    })

    it('prevents default on tool key', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      const event = fireKey({ code: 'KeyP', key: 'p' })
      expect(event.defaultPrevented).toBe(true)
    })
  })

  describe('disabled', () => {
    it('does not fire when disabled is true', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ disabled: true, actions }))

      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true })
      fireKey({ code: 'KeyP', key: 'p' })
      expect(actions.onUndo).not.toHaveBeenCalled()
      expect(actions.onPenTool).not.toHaveBeenCalled()
    })
  })

  describe('input focus', () => {
    it('does not fire when target is an input element', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      try {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'KeyP',
          key: 'p',
        })
        input.dispatchEvent(event)
        expect(actions.onPenTool).not.toHaveBeenCalled()
      } finally {
        document.body.removeChild(input)
      }
    })

    it('does not fire when target is a textarea element', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      try {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'KeyE',
          key: 'e',
        })
        textarea.dispatchEvent(event)
        expect(actions.onEraserTool).not.toHaveBeenCalled()
      } finally {
        document.body.removeChild(textarea)
      }
    })
  })

  describe('no false positives', () => {
    it('does not fire tool shortcuts when modifier is held', () => {
      const actions = createActions()
      renderHook(() => useKeyboardShortcuts({ actions }))

      fireKey({ code: 'KeyP', key: 'p', ctrlKey: true })
      fireKey({ code: 'KeyE', key: 'e', altKey: true })
      expect(actions.onPenTool).not.toHaveBeenCalled()
      expect(actions.onEraserTool).not.toHaveBeenCalled()
    })
  })
})

describe('getModifierPrefix', () => {
  it('returns Ctrl+ in jsdom (non-Mac)', () => {
    expect(getModifierPrefix()).toBe('Ctrl+')
  })
})
