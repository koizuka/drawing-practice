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
- **Immediate-save path** for discrete user intents: `useAutosave` takes a separate `flushVersion` prop. `SplitLayout`'s `incrementFlushVersion()` is called from `changeReference`, `resetReferenceOnError`, the reference snapshot restorer (undo/redo), `handleToggleReferenceCollapsed`, `handleToggleFlip`, the guide-version effect, and the camera flush listener. The hook observes the bump in a useEffect (so React has already committed the setState updates), cancels any pending debounce timer, and queues `saveDraft` immediately (no debounce — the IndexedDB write itself is still async). **Why:** a reload immediately after a discrete action would otherwise lose the explicit user intent. Stroke changes still go through the 2s debounce path.
- **Camera (pan/zoom)** is persisted as part of the draft. `ViewTransform.subscribe` forwards a `CameraIntent | null` to listeners; `SplitLayout`'s flush listener dispatches policy from the intent: `'gesture'` tail-debounces an `incrementFlushVersion` after 250ms of stillness (one save per gesture, not per frame); `'userReset'` and `'contentLoad'` flush immediately; `'restore'` is gated off by `suppressAutosaveRef`; `null` (emitted by `adjustForUnfit`) short-circuits before the flush logic so visual-scale preservation never triggers a spurious save. On restore, the camera is buffered in `pendingCameraRef` when the active source mounts a viewer that calls `loadContent(0,0,1)` (image / url / pexels / youtube / sketchfab-fixed), and applied via `viewTransform.restoreCamera` from a parent effect keyed on `referenceSize` — runs after the viewer's `loadContent` so the persisted camera wins. Sources without such a viewer apply the camera directly during `loadDraft`.

Persisted: strokes, redo stack, reference, guides, timer elapsed, camera (viewCenter + zoom), flipped.
**NOT persisted**: reference undo history (kept session-only — see `drawing-undo.md`).

Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.
