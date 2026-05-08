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
- `delete` — single stroke erased (tap eraser)
- `lasso-delete` — batch erase: N strokes deleted as one undo unit (lasso). Items stored ascending by index; undo splices them back in ascending order, redo splices out in descending order so indices stay valid.
- `reference` — reference (source/mode/image/Sketchfab angle) changed

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
