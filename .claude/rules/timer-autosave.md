---
paths:
  - "src/hooks/useTimer.ts"
  - "src/hooks/useAutosave.ts"
  - "src/components/SplitLayout.tsx"
---

# Timer & autosave rules

## Timer (`useTimer`)

**Auto-starts on**:
- First stroke completion.
- Resume on next stroke after any pause.
- Redo when strokes are restored while the timer is stopped (e.g. after undo emptied history).

**Pauses on**:
- App backgrounded (`visibilitychange` API).
- Save.
- Opening the gallery.
- Any reference change (source / mode / fixed image / local image / Sketchfab angle / gallery "use this reference").

Reference-related pausing is wired through `pauseAndIncrementVersion` in `SplitLayout`. `changeReference` calls it after recording the undo entry and applying the mutation.

**Resets on**:
- Clear button.
- When undo drains the history stack (`!canUndo()`). **Why:** treating a fully-undone session as "pre-drawing" keeps the reset path reachable even though the trash button is disabled while strokeCount is 0.

**Erase and redo do NOT touch the timer.**

`restore(ms)` sets elapsed without starting (used by autosave restore).

## Autosave (`useAutosave`)

- Debounced **2s** persistence of session state to IndexedDB `session` table.
- Tracks changes via a version counter incremented by state setters in `SplitLayout`.
- **Suppressed during draft restore** to avoid overwriting with partial state.
- Clears draft when session is empty (no strokes and no reference).

Persisted: strokes, redo stack, reference, guides, timer elapsed.
**NOT persisted**: reference undo history (kept session-only — see `drawing-undo.md`).

Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.
