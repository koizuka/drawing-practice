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
- **Immediate-save path** for discrete user intents: `useAutosave` takes a separate `flushVersion` prop. `SplitLayout`'s `recordDiscreteUserAction(reason)` helper bumps `flushVersion` for every named intent (`collapse` / `flip` / `reference` / `referenceError` / `referenceSnapshotRestore` / `guide` / `cameraGesture` / `cameraReset` / `cameraContentLoad`). The hook observes the bump in a useEffect (so React has already committed the setState updates), cancels any pending debounce timer, and queues `saveDraft` immediately (no debounce — the IndexedDB write itself is still async). **Why:** a reload immediately after a discrete action would otherwise lose the explicit user intent. Stroke changes still go through the 2s debounce path. The string `reason` argument exists so call sites are grep-able and exhaustive in the type system; today the policy is uniform but a future per-reason branch can land without churning every site.
- **Camera (pan/zoom)** is persisted as part of the draft. `ViewTransform` exposes typed UI intents (`'gesture'` / `'userReset'` / `'contentLoad'` / `'restore'`) via `onIntent`; `SplitLayout` subscribes and dispatches the flush policy from the intent itself: `'gesture'` tail-debounces a `recordDiscreteUserAction('cameraGesture')` after 250ms of stillness (one save per gesture, not per frame), `'userReset'` and `'contentLoad'` flush immediately via `cameraReset` / `cameraContentLoad`, `'restore'` is a no-op while `suppressAutosaveRef` is up. On restore, the camera is buffered in `pendingCameraRef` when the active source mounts a viewer that calls `loadContent(0,0,1)` (image / url / pexels / youtube / sketchfab-fixed), and applied via `viewTransform.restoreCamera` from a parent effect keyed on `referenceSize` — runs after the viewer's `loadContent` so the persisted camera wins. Sources without such a viewer apply the camera directly during `loadDraft`. Visual-scale preservation when closing a reference uses `adjustForUnfit`, which is silent on `onIntent` to avoid a spurious autosave flush.

Persisted: strokes, redo stack, reference, guides, timer elapsed, camera (viewCenter + zoom), flipped.
**NOT persisted**: reference undo history (kept session-only — see `drawing-undo.md`).

Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.
