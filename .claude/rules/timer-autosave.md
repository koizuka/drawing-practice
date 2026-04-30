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
- **Immediate-save path** for reference changes: `useAutosave` takes a separate `flushVersion` prop. `changeReference`, `resetReferenceOnError`, and the reference snapshot restorer (undo/redo) bump it via `incrementFlushVersion`. The hook observes the bump in a useEffect (so React has already committed the setState updates), cancels any pending debounce timer, and queues `saveDraft` immediately (no debounce — the IndexedDB write itself is still async). **Why:** a reload immediately after a reference swap would otherwise restore the previous reference. Stroke and guide changes still go through the 2s debounce path.

Persisted: strokes, redo stack, reference, guides, timer elapsed.
**NOT persisted**: reference undo history (kept session-only — see `drawing-undo.md`).

Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.
