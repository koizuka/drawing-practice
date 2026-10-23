import { useEffect, useCallback } from 'react';

/** Detect Apple platforms (Mac, iPad, iPhone) for Cmd vs Ctrl */
function isMacPlatform(): boolean {
  const platform = navigator.platform ?? '';
  return /Mac|iPad|iPhone/.test(platform);
}

/** Returns display string for the platform modifier key (⌘ or Ctrl+) */
export function getModifierPrefix(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl+';
}

interface ShortcutActions {
  onUndo: () => void;
  onRedo: () => void;
  onPenTool: () => void;
  onEraseTool: () => void;
  onSave: () => void;
  onResetZoom: () => void;
  /** Rotate the drawing view 15° counter-clockwise / clockwise (Krita's 4 / 6). */
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  /** Rotate the drawing view back upright (Krita's 5). */
  onResetRotation?: () => void;
}

interface UseKeyboardShortcutsOptions {
  /** When true, all shortcuts are suppressed (e.g. gallery modal open) */
  disabled?: boolean;
  actions: ShortcutActions;
}

export function useKeyboardShortcuts({ disabled, actions }: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;

      // Skip when focus is inside a text input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isMac = isMacPlatform();
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Undo: Cmd/Ctrl+Z (without Shift)
      if (mod && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        actions.onUndo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z
      if (mod && e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        actions.onRedo();
        return;
      }

      // Redo: Cmd/Ctrl+Y
      if (mod && !e.shiftKey && e.code === 'KeyY') {
        e.preventDefault();
        actions.onRedo();
        return;
      }

      // Save: Cmd/Ctrl+S
      if (mod && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        actions.onSave();
        return;
      }

      // Reset zoom: Cmd/Ctrl+0 (also Numpad 0)
      if (mod && !e.shiftKey && !e.altKey && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault();
        actions.onResetZoom();
        return;
      }

      // View rotation (no modifiers): Krita's defaults, main row or numpad.
      // Matched on e.code so the keys work regardless of keyboard layout.
      if (!mod && !e.altKey && !e.shiftKey) {
        const rotate =
          e.code === 'Digit4' || e.code === 'Numpad4'
            ? actions.onRotateLeft
            : e.code === 'Digit6' || e.code === 'Numpad6'
              ? actions.onRotateRight
              : e.code === 'Digit5' || e.code === 'Numpad5'
                ? actions.onResetRotation
                : undefined;
        if (rotate) {
          e.preventDefault();
          rotate();
          return;
        }
      }

      // Tool shortcuts (no modifiers)
      if (!mod && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'p':
          case 'b':
            e.preventDefault();
            actions.onPenTool();
            break;
          // E and L both enter the unified erase/select mode. L is kept as an
          // alias for users who learned the old lasso shortcut.
          case 'e':
          case 'l':
            e.preventDefault();
            actions.onEraseTool();
            break;
        }
      }
    },
    [disabled, actions],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
