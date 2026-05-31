---
paths:
  - "src/hooks/useTimer.ts"
  - "src/hooks/useAutosave.ts"
  - "src/components/SplitLayout.tsx"
---

# Timer & autosave rules

## Timer (`useTimer`)

**Auto-starts on**:
- Stroke START (pen-down), not stroke completion. `DrawingCanvas` fires `onStrokeStart` on pen-down (pen mode, after the stylus filter, single touch not escalated to pinch); `DrawingPanel.handleStrokeStart` calls `timer.start()` when the timer is stopped. **Why:** counting from pen-down means a long opening stroke is timed instead of jumping from 0 only when the pen lifts. Covers the first stroke and resume-after-pause uniformly.
- Redo when strokes are restored while the timer is stopped (e.g. after undo emptied history).
- `handleStrokeCountChange` keeps a `!isRunning && strokes>0 → start()` guard as a safety net for non-pen commit paths (e.g. lasso-delete) that never fire `onStrokeStart`. On the pen path the timer is already running by commit time, so it's a no-op there.

**Caveat (accepted):** starting at pen-down decouples "timer running" from "a stroke committed". A pen-down whose stroke never commits — escalated to a pinch (`cancelStroke`), freeze-recovery cancel, or a trace stroke rejected by scoring (`discardLastStroke`) — leaves the timer running with no committed stroke (on a fresh canvas it ticks from 0; mid-session it just keeps the existing reading). It self-corrects on the next real stroke; the leaked interval is the pinch-recognition window in practice. Not compensated — doing so would need a cancel signal plumbed from `DrawingCanvas` back to the timer.

**Pauses on**:
- App backgrounded (`visibilitychange` API).
- Save.
- Opening the gallery.
- Any reference change (source / mode / fixed image / local image / Sketchfab angle / gallery "use this reference").
- **Trash button (tentative clear)**. `DrawingPanel.handleClear` calls `timer.pause()` — NOT `reset()` — so Undo of the clear restores the elapsed reading alongside the strokes. The reset happens only later, when the user starts drawing again (see "Resets on" below).

Reference-related pausing is wired through `pauseAndIncrementVersion` in `SplitLayout`. `changeReference` calls it after recording the undo entry and applying the mutation.

**Resets on**:
- When undo drains the history stack (`!canUndo()`). **Why:** treating a fully-undone session as "pre-drawing" keeps the reset path reachable even though the trash button is disabled while strokeCount is 0.
- **Stroke START while a tentative clear is active** (trash button or reference change auto-clear). `DrawingPanel.handleStrokeStart` reads `strokeManager.isTentativeClearActive()` on pen-down and calls `timer.reset()` (then `start()`). **Why:** starting to draw means the user is starting a new drawing — counting time from before the clear would surprise them, and resetting at pen-down (rather than on release) times the new opening stroke. The tentative clear itself is still committed later by `endStroke`. See `drawing-undo.md` "Tentative clear" for the broader semantics.

**Erase and redo do NOT touch the timer.**

`restore(ms)` sets elapsed without starting (used by autosave restore).

## Autosave (`useAutosave`)

- Debounced **2s** persistence of session state to IndexedDB `session` table.
- Tracks changes via a version counter incremented by state setters in `SplitLayout`.
- **Suppressed during draft restore** to avoid overwriting with partial state.
- Clears draft when session is empty (no strokes and no reference).
- **Immediate-save path** for discrete user intents: `useAutosave` takes a separate `flushVersion` prop. `SplitLayout`'s `incrementFlushVersion()` is called from `changeReference`, `resetReferenceOnError`, the reference snapshot restorer (undo/redo), `handleToggleReferenceCollapsed`, `handleToggleFlip`, the guide-version effect, the camera flush listener, and `DrawingPanel.onGallerySaved` (so the post-save `gallerySaveDirty=false` lands before the user could reload). The hook observes the bump in a useEffect (so React has already committed the setState updates), cancels any pending debounce timer, and queues `saveDraft` immediately (no debounce — the IndexedDB write itself is still async). **Why:** a reload immediately after a discrete action would otherwise lose the explicit user intent. Freehand stroke commits still go through the 2s debounce path.
- **Discrete stroke-edit buttons flush too.** `handleStrokesChanged(opts?: { flush?: boolean })` in `SplitLayout` dispatches `incrementFlushVersion()` when `opts.flush` is set, else `incrementChangeVersion()` (2s debounce). `DrawingPanel` passes `{ flush: true }` from the discrete editing operations — **undo, redo, clear (trash), delete-highlighted** (all via `triggerRedraw({ flush: true })`) — and `DrawingCanvas` forwards `flush: true` through `onStrokeCountChange` for a **lasso-delete** commit. **Why:** these are deliberate button/erase actions, same intent as flip / grid / collapse — a reload right after should keep the result. A plain freehand stroke commit (`handleStrokeCountChange` with no `flush`) deliberately stays on the 2s debounce because continuous drawing benefits from batching (one IndexedDB write per idle window rather than per stroke).
- **Camera (pan/zoom)** is persisted as part of the draft. `ViewTransform.subscribe` forwards a `CameraIntent | null` to listeners; `SplitLayout`'s flush listener dispatches policy from the intent: `'gesture'` tail-debounces an `incrementFlushVersion` after 250ms of stillness (one save per gesture, not per frame); `'userReset'` and `'contentLoad'` flush immediately; `'restore'` is gated off by `suppressAutosaveRef`; `null` (emitted by `adjustForUnfit`) short-circuits before the flush logic so visual-scale preservation never triggers a spurious save. On restore, the camera is buffered in `pendingCameraRef` when the active source mounts a viewer that calls `loadContent(0,0,1)` (image / url / pexels / youtube / sketchfab-fixed), and applied via `viewTransform.restoreCamera` from a parent effect keyed on `referenceSize` — runs after the viewer's `loadContent` so the persisted camera wins. Sources without such a viewer apply the camera directly during `loadDraft`.

Persisted: strokes, redo stack, reference, guides, timer elapsed, camera (viewCenter + zoom), flipped, `gallerySaveDirty`.
**NOT persisted**: reference undo history (kept session-only — see `drawing-undo.md`).

`gallerySaveDirty` is read at autosave time from `StrokeManager.isDirtySinceGallerySave()` (see `drawing-undo.md`). On restore, `SplitLayout.loadDraft` calls `markSavedToGallery()` after `loadState` when the draft says `gallerySaveDirty === false` — `loadState` bumps the mutation counter, so the explicit mark is what carries the saved/clean state across reload. Pre-feature drafts (no field) default to dirty=true.

Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.

## Trace-template restore

When `draft.source === 'trace-template'`:
- `loadDraft`'s reference-restore else-if chain explicitly calls `setReferenceMode('fixed')`. There's no `fixedImageUrl` to set (the template strokes come from `getBundledTemplate(templateId)` keyed off `referenceInfo.templateId`). Without this branch, `referenceMode` stays at its `useState('browse')` default and `ReferencePanel` renders the picker instead of the active template.
- `referenceWillSize` includes `'trace-template'` so the camera-restore path defers via `pendingCameraRef` (applied after `TraceTemplateViewer` mounts and fires `onTemplateLoaded` → setReferenceSize). Without this, the persisted pan/zoom would be stomped by the viewer's `loadContent(0, 0, 1)`.

Scoring history (`attemptHistory`, `allTimeStats`, `attemptMap`, `latestFeedback`) is **NOT persisted** — only the active template selection survives reload. Strokes the user drew while tracing are restored via the normal autosave path but become "untracked" with respect to the new session's scoring (they're regular strokes with no scoring history). Documented MVP limitation; see `trace-template.md`.
