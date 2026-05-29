---
paths:
  - "src/drawing/**"
  - "src/components/SplitLayout.tsx"
  - "src/components/DrawingPanel.tsx"
---

# Drawing & undo system rules

## StrokeManager

Single chronological undo/redo stack shared by **strokes AND reference changes**. Discriminated union entries:
- `add` — stroke added
- `delete` — single stroke erased (erase-mode tap: a press that releases without crossing the lasso threshold)
- `lasso-delete` — batch erase: N strokes deleted as one undo unit (erase-mode lasso: a press that drags past the threshold and encloses strokes). Items stored ascending by index; undo splices them back in ascending order, redo splices out in descending order so indices stay valid.
- `reference` — reference (source/mode/image/Sketchfab angle) changed
- `clear` — tentative clear: captures the live strokes so Undo can restore them, plus the empty visible state. Drawing a new stroke commits the clear (entry + the pre-clear `add` / `delete` / `lasso-delete` entries that referenced the cleared strokes are dropped together — see "Tentative clear" below).

Reference entries are restored via an injected `ReferenceRestorer` callback. `undo(captureCurrentRef)` / `redo(captureCurrentRef)` accept a snapshot factory so the opposite stack can record the "current" reference before swapping.

`MAX_REFERENCE_HISTORY = 20` caps reference entries via `undoReferenceCount` for O(1) pruning. **Why:** reference snapshots can hold large data URLs; unbounded growth would balloon memory.

## Stroke quantization invariant

Every `Point` in `currentStroke.points` and `this.strokes[]` is snapped to the 0.1px grid (`src/drawing/quantize.ts`). Quantization is applied at the entry boundary — `startStroke`, `appendStroke`, and `loadState` — so all downstream code (redraw, hit-test, autosave serialization, undo/redo, save) operates on the smaller, deduplicated arrays. `appendStroke` returns `boolean`: `false` when the new point collapses onto the previous one after quantization, so callers (e.g. `DrawingCanvas` pointer-move handlers) can skip redundant `requestRedraw` and `onCurrentStrokeChange` notifications. **Why:** Apple Pencil at 120Hz produces many points landing in the same 0.1px cell when drawing slowly; dedup-on-entry shrinks memory continuously and keeps redraw cost proportional to actual visual change. `endStroke` is left as the place for any future whole-stroke refinement (RDP simplification, smoothing, end-snap) that needs the entire stroke before it can act.

## Reference undo wiring (in SplitLayout)

- The `StrokeManager` instance is owned by `SplitLayout` and passed down to `DrawingPanel` / `DrawingCanvas` as a prop. **Why:** autosave restore loads strokes into it during `loadDraft.then`, before the panels are mounted (see the restore-gate invariant in `CLAUDE.md`).
- `DrawingPanel` reads `canUndo`/`canRedo`/`strokeCount` inline from the `StrokeManager` each render rather than mirroring them into local state. **Why:** state-mirroring needed a follow-up `useEffect([restoreVersion, historySyncVersion])` to resync after restore/reference-change, producing a second commit that flickered the toolbar's enabled state. Inline reads pick up new values on the same commit that bumps `restoreVersion` / `historySyncVersion`.
- All reference mutations go through `changeReference(mutate)` — it records an undo entry, applies the mutation, and bumps `historySyncVersion` so DrawingPanel re-renders and the inline `canUndo`/`canRedo` reads reflect the new stack state.
- `captureReferenceSnapshot` / `applyReferenceSnapshot` (registered via `StrokeManager.setReferenceRestorer`) handle the capture+restore roundtrip.
- Image-load errors use a separate **non-undoable** `onReferenceResetOnError` path. **Why:** a failed load shouldn't pollute history with an unrecoverable state.
- Reference history is **session-only**, NOT persisted in the autosave draft. **Why:** keeps IndexedDB bounded — after reload only current reference + strokes are restored.

## CanvasRenderer / ViewTransform

- `CanvasRenderer` — stroke rendering with highlight support.
- `ViewTransform` — pinch zoom/pan, scale clamped to **0.25x ~ 8x**.

## DrawingPanel undo button behavior

Undo/redo handles BOTH strokes and reference changes via the same button. Pass parent's `captureReferenceSnapshot` to `StrokeManager.undo/redo` so the restorer can swap back the previous reference.

## Gallery-save dirty tracking

`StrokeManager` exposes `markSavedToGallery()` / `isDirtySinceGallerySave()`, backed by an internal `mutationCount` bumped via the private `bumpMutation()` funnel on every stroke-modifying transition (endStroke / undo / redo of stroke entries / deleteStroke / lassoDelete / loadState / clear). **Reference-only undo entries deliberately do NOT bump it** — swapping references doesn't change the drawing the user would save. The save button reads `isDirtySinceGallerySave()` inline (same pattern as `canUndo`/`canRedo`) so React commits flow without state-mirroring. **Why:** prevents duplicate gallery entries from accidental save-button or `Cmd/Ctrl+S` repeats.

`loadState` bumps `mutationCount` (it's a stroke-set-replacing mutation), so any restore path that wants to restore a non-dirty state must call `markSavedToGallery()` immediately after `loadState` — see `SplitLayout.loadDraft` and the deferred-migration path in `handleReferenceImageSize`.

## Stroke timestamp uniqueness (`lastIssuedTimestamp`)

`startStroke` issues each new `Stroke.timestamp` via `nextTimestamp() = max(Date.now(), lastIssuedTimestamp + 1)` so consecutive strokes always get strictly monotonic timestamps even when the wall clock returns the same `Date.now()` value (tight test loops, low-resolution clocks, rapid-fire pen taps). `loadState` advances `lastIssuedTimestamp` past every restored stroke's timestamp so post-restore strokes can't collide with restored ones either.

**Why this matters:** `Stroke.timestamp` doubles as a stable per-session identity key for trace-template scoring (`attemptMap: templateIdx → strokeTimestamp`). A collision would silently mis-resolve a re-trace's "previous attempt" lookup, leaving an orphan stroke in the manager that no scoring entry tracks. Tests exercise the bursty case (`TraceScoringContext.test.tsx`'s re-trace path); the production path's safety relies on the same monotonic guarantee.

## Tentative clear (`tentativeClear` vs destructive `clear`)

Two clear paths exist:

- **`tentativeClear()`** — soft clear used by the trash button (`DrawingPanel.handleClear`) and by `SplitLayout.changeReference` (user-initiated reference changes only — `recordUndo: false` paths bypass it). Pushes a `'clear'` entry holding a `.slice()` of the current strokes onto `undoStack`, sets `strokes = []`, clears `currentStroke` and `redoStack`, sets the `tentativeClearState` flag (also holding its own `.slice()` so the two snapshots cannot alias). **Does NOT bump mutation** — see "Gallery-dirty parity" below. No-op when already tentative or when `strokes.length === 0`. Repeated calls within the same tentative session are ignored — the trash button is also visually disabled while `strokeCount === 0`, so users don't accumulate duplicate clears.

- **`clear()`** — destructive wipe used by the gesture-session per-pose advance (`SplitLayout.resetForNextPose`). Drops all strokes AND the entire undo/redo stack including reference history. Use only when Undo recovery is undesirable.

**Commit on next stroke**: `endStroke()` checks `tentativeClearState` before committing. If active, `commitTentativeClear()` runs a single-pass survival filter over `undoStack`: it drops the `'clear'` entry itself AND any older `add` / `delete` / `lasso-delete` entries that reference the cleared strokes (by timestamp). **Why:** those pre-clear entries would otherwise reference strokes no longer in `strokes[]`, leaving the undo stack inconsistent (Undo of an `add` would pop the wrong stroke). The user committed to "starting fresh," so the cleared strokes — and granular undo of them — are gone for good. `reference` entries sit between `'clear'` and `endStroke()` when the user changes reference while tentative; those survive the commit and stay individually undoable.

**Why scan-from-stack instead of "is `clear` on top"**: a `reference` entry can be pushed above the `clear` entry when the user changes references while tentative (the auto-`tentativeClear()` in `changeReference` is a no-op the second time around because `tentativeClearState !== null`, but the `recordReferenceChange` part still pushes its entry). The single-pass filter on commit handles this naturally; assuming the `clear` is at the top would miss it.

**Undo / Redo**:
- `undo()` popping a `'clear'` entry restores `strokes = entry.strokes.slice()` (independent copy), clears `tentativeClearState`, pushes the original `entry.strokes` onto `redoStack`. **Does NOT bump mutation** — see "Gallery-dirty parity". UndoResult is `{ kind: 'strokes', strokes }` — same shape as lasso-delete undo.
- `redo()` popping a `'clear'` redo entry re-enters tentative state (sets `tentativeClearState.savedStrokes = entry.strokes.slice()`, empties strokes, pushes the original `entry.strokes` back onto `undoStack`). Also does NOT bump mutation. A subsequent new stroke commits cleanly.

**Persistence**: `tentativeClearState` is **in-memory only**. The autosave draft persists `strokes = []` while tentative, so a reload after clearing lands with no strokes and no Undo entry. Consistent with the existing "reference history is session-only" rule.

**Gallery-dirty parity**: `tentativeClear()`, `undo()` of `'clear'`, and `redo()` of `'clear'` deliberately do NOT call `bumpMutation()`. The strokes the user would save haven't changed: a tentative clear is fully reversible, and any commit happens later via `endStroke` (which bumps mutation as part of attaching the new stroke). **Why this matters:** without this, Save → Trash → Undo would leave `gallerySaveDirty = true` even though strokes are bit-identical to the last save, letting a Cmd+S burst or the still-enabled Save button write a duplicate gallery entry. The fix lives in `StrokeManager.tentativeClear` / `undo` / `redo` (search for "Intentionally NOT").

**Aliasing**: `tentativeClear()` stores a `.slice()` of `this.strokes` in the `'clear'` entry, and `undo()` re-restores `this.strokes` from another `.slice()` of `entry.strokes`. `redo()` similarly copies into the new `tentativeClearState`. **Why:** without these copies, `this.strokes`, the undo entry, and the redo entry alias the same `Stroke[]` after `undo`-of-clear. Any later mutation of `this.strokes` (e.g. `push` inside `endStroke`) leaks backwards into the redo entry and corrupts a subsequent re-redo. Today the `endStroke` `redoStack = []` line happens to wipe the polluted entry before any observer, but the invariant should be local to the snapshot, not load-bearing on statement order across methods.

**Timer interaction**: `DrawingPanel.handleClear` calls `timer.pause()` (NOT `timer.reset()`) on tentative clear so Undo restores the elapsed reading alongside the strokes. Commit-on-new-stroke flows through `DrawingCanvas` → `notifyStrokeCount({ committedTentativeClear })` → `DrawingPanel.handleStrokeCountChange` which calls `timer.reset()` before the existing `timer.start()` guard. `isTentativeClearActive()` must be read in `DrawingCanvas` BEFORE `endStroke()` runs — `endStroke` clears the flag as part of committing.

**Trace scoring order**: `DrawingPanel.handleClear` runs `onTraceResetScores()` **before** `strokeManager.tentativeClear()`. `resetScores` calls `strokeManager.discardStrokes(scoredTimestamps)` which only matches strokes that are still in `getStrokes()` — running it after `tentativeClear` (which empties `getStrokes()`) would early-return in `discardStrokes`, leaving the scored strokes inside the `'clear'` undo entry. Undo would resurrect them as untracked ghosts AND `attemptMap` is already wiped, so a follow-up re-trace cannot replace them — leaving permanent duplicates on the same template target. With the corrected order, scored strokes are removed from `this.strokes` first, then `tentativeClear()` saves only the remaining (unscored) strokes. In a pure trace session where every stroke is scored, `tentativeClear` becomes a no-op and the trash button is effectively destructive for that click — Undo recovers nothing. Trade-off accepted for correctness.

**Trace scoring history**: `onTraceResetScores()` clears `attemptHistory` / `attemptMap` / `allTimeStats` synchronously. Undo restores strokes but not scoring history — restored strokes are untracked ghosts in `attemptMap` (only an issue for unscored strokes, since scored ones were pruned above before they could enter the clear entry). Documented MVP limitation.

## Non-undoable bulk removal (`discardLastStroke`, `discardStrokes`)

Two paths exist for removing strokes that should NOT be Undo-able:

- **`discardLastStroke()`** — pops the most recent stroke and the matching `add` entry. Used by `TraceScoringContext` on an out-of-range attempt: the user drew a stroke that didn't match any template, so it never "happened" from the user's perspective. If we left an `add`+`delete` pair on the undo stack, Undo would resurrect the rejected stroke as an untracked ghost — and the next valid re-trace would mis-replace it (see `Trace template scoring` in `trace-template.md`).
- **`discardStrokes(timestamps)`** — bulk variant for `TraceScoringContext.resetScores`. Removes every matching stroke AND every matching `add` entry (counted by position; `add` entries are in stroke order regardless of interleaved `reference` entries). Also clears `redoStack` to avoid stale references. Used when the user clicks the reset-trace-score button: the scoring history is being wiped, so leaving the strokes recoverable via Undo would put the user in an inconsistent state where the strokes exist but no scoring tracks them.

Neither method bumps `redoStack` for the discarded strokes (there's no logical "redo of a discard"), and neither calls the `reference` undo machinery. Both call `bumpMutation()` so the gallery-dirty flag and any future change observers see the mutation.

**When to use which over `deleteStroke` / `lassoDelete`**: the regular methods push undo entries so the user can recover an accidental erase. The `discard*` methods are for programmatic cleanup where Undo recovery would corrupt invariants. The contract is "this removal is final from the user's point of view too."
