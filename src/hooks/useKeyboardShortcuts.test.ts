import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, getModifierPrefix } from './useKeyboardShortcuts';

function fireKey(options: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
}

function createActions() {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onPenTool: vi.fn(),
    onEraseTool: vi.fn(),
    onSave: vi.fn(),
    onResetZoom: vi.fn(),
    onRotateLeft: vi.fn(),
    onRotateRight: vi.fn(),
    onResetRotation: vi.fn(),
  };
}

// Use ctrlKey for tests (non-Mac platform in jsdom)
describe('useKeyboardShortcuts', () => {
  describe('Undo (Ctrl+Z)', () => {
    it('fires onUndo on Ctrl+Z', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true });
      expect(actions.onUndo).toHaveBeenCalledOnce();
    });

    it('does not fire onUndo on Ctrl+Shift+Z', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true });
      expect(actions.onUndo).not.toHaveBeenCalled();
    });
  });

  describe('Redo', () => {
    it('fires onRedo on Ctrl+Shift+Z', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true });
      expect(actions.onRedo).toHaveBeenCalledOnce();
    });

    it('fires onRedo on Ctrl+Y', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyY', key: 'y', ctrlKey: true });
      expect(actions.onRedo).toHaveBeenCalledOnce();
    });
  });

  describe('Tool shortcuts', () => {
    it('fires onPenTool on P', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyP', key: 'p' });
      expect(actions.onPenTool).toHaveBeenCalledOnce();
    });

    it('fires onPenTool on B', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyB', key: 'b' });
      expect(actions.onPenTool).toHaveBeenCalledOnce();
    });

    it('fires onEraseTool on E', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyE', key: 'e' });
      expect(actions.onEraseTool).toHaveBeenCalledOnce();
    });

    it('fires onEraseTool on L (legacy lasso alias)', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyL', key: 'l' });
      expect(actions.onEraseTool).toHaveBeenCalledOnce();
    });
  });

  describe('Save (Ctrl+S)', () => {
    it('fires onSave on Ctrl+S', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyS', key: 's', ctrlKey: true });
      expect(actions.onSave).toHaveBeenCalledOnce();
    });
  });

  describe('Reset zoom (Ctrl+0)', () => {
    it('fires onResetZoom on Ctrl+0', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const event = fireKey({ code: 'Digit0', key: '0', ctrlKey: true });
      expect(actions.onResetZoom).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('fires onResetZoom on Ctrl+Numpad0', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const event = fireKey({ code: 'Numpad0', key: '0', ctrlKey: true });
      expect(actions.onResetZoom).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not fire on Ctrl+Shift+0', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'Digit0', key: '0', ctrlKey: true, shiftKey: true });
      expect(actions.onResetZoom).not.toHaveBeenCalled();
    });

    it('does not fire on plain 0 (no modifier)', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'Digit0', key: '0' });
      expect(actions.onResetZoom).not.toHaveBeenCalled();
    });

    it('does not fire when target is an input element', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Digit0',
          key: '0',
          ctrlKey: true,
        });
        input.dispatchEvent(event);
        expect(actions.onResetZoom).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(input);
      }
    });
  });

  describe('View rotation (4 / 5 / 6, Krita defaults)', () => {
    it.each([
      ['Digit4', '4', 'onRotateLeft'],
      ['Numpad4', '4', 'onRotateLeft'],
      ['Digit6', '6', 'onRotateRight'],
      ['Numpad6', '6', 'onRotateRight'],
      ['Digit5', '5', 'onResetRotation'],
      ['Numpad5', '5', 'onResetRotation'],
    ] as const)('%s fires %s', (code, key, action) => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));
      const event = fireKey({ code, key });
      expect(actions[action]).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores rotation keys with a modifier', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));
      fireKey({ code: 'Digit6', key: '6', ctrlKey: true });
      fireKey({ code: 'Digit6', key: '^', shiftKey: true });
      expect(actions.onRotateRight).not.toHaveBeenCalled();
    });
  });

  describe('preventDefault', () => {
    it('prevents default on Ctrl+Z', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const event = fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
    });

    it('prevents default on tool key', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const event = fireKey({ code: 'KeyP', key: 'p' });
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('disabled', () => {
    it('does not fire when disabled is true', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ disabled: true, actions }));

      fireKey({ code: 'KeyZ', key: 'z', ctrlKey: true });
      fireKey({ code: 'KeyP', key: 'p' });
      expect(actions.onUndo).not.toHaveBeenCalled();
      expect(actions.onPenTool).not.toHaveBeenCalled();
    });
  });

  describe('input focus', () => {
    it('does not fire when target is an input element', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'KeyP',
          key: 'p',
        });
        input.dispatchEvent(event);
        expect(actions.onPenTool).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(input);
      }
    });

    it('does not fire when target is a textarea element', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      try {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'KeyE',
          key: 'e',
        });
        textarea.dispatchEvent(event);
        expect(actions.onEraseTool).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(textarea);
      }
    });
  });

  describe('no false positives', () => {
    it('does not fire tool shortcuts when modifier is held', () => {
      const actions = createActions();
      renderHook(() => useKeyboardShortcuts({ actions }));

      fireKey({ code: 'KeyP', key: 'p', ctrlKey: true });
      fireKey({ code: 'KeyE', key: 'e', altKey: true });
      expect(actions.onPenTool).not.toHaveBeenCalled();
      expect(actions.onEraseTool).not.toHaveBeenCalled();
    });
  });
});

describe('getModifierPrefix', () => {
  it('returns Ctrl+ in jsdom (non-Mac)', () => {
    expect(getModifierPrefix()).toBe('Ctrl+');
  });
});
