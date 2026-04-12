import { useEffect, useCallback } from 'react'

/** Detect Apple platforms (Mac, iPad, iPhone) for Cmd vs Ctrl */
function isMacPlatform(): boolean {
  const platform = navigator.platform ?? ''
  return /Mac|iPad|iPhone/.test(platform)
}

/** Returns display string for the platform modifier key (⌘ or Ctrl+) */
export function getModifierPrefix(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl+'
}

interface ShortcutActions {
  onUndo: () => void
  onRedo: () => void
  onPenTool: () => void
  onEraserTool: () => void
  onSave: () => void
}

interface UseKeyboardShortcutsOptions {
  /** When true, all shortcuts are suppressed (e.g. gallery modal open) */
  disabled?: boolean
  actions: ShortcutActions
}

export function useKeyboardShortcuts({ disabled, actions }: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (disabled) return

    // Skip when focus is inside a text input
    const target = e.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }

    const isMac = isMacPlatform()
    const mod = isMac ? e.metaKey : e.ctrlKey

    // Undo: Cmd/Ctrl+Z (without Shift)
    if (mod && !e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault()
      actions.onUndo()
      return
    }

    // Redo: Cmd/Ctrl+Shift+Z
    if (mod && e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault()
      actions.onRedo()
      return
    }

    // Redo: Cmd/Ctrl+Y
    if (mod && !e.shiftKey && e.code === 'KeyY') {
      e.preventDefault()
      actions.onRedo()
      return
    }

    // Save: Cmd/Ctrl+S
    if (mod && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault()
      actions.onSave()
      return
    }

    // Tool shortcuts (no modifiers)
    if (!mod && !e.altKey && !e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'p':
        case 'b':
          e.preventDefault()
          actions.onPenTool()
          break
        case 'e':
          e.preventDefault()
          actions.onEraserTool()
          break
      }
    }
  }, [disabled, actions])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
