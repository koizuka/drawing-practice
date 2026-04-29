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
- `delete` — stroke erased
- `reference` — reference (source/mode/image/Sketchfab angle) changed

Reference entries are restored via an injected `ReferenceRestorer` callback. `undo(captureCurrentRef)` / `redo(captureCurrentRef)` accept a snapshot factory so the opposite stack can record the "current" reference before swapping.

`MAX_REFERENCE_HISTORY = 20` caps reference entries via `undoReferenceCount` for O(1) pruning. **Why:** reference snapshots can hold large data URLs; unbounded growth would balloon memory.

## Reference undo wiring (in SplitLayout)

- All reference mutations go through `changeReference(mutate)` — it records an undo entry, applies the mutation, and bumps `historySyncVersion` so DrawingPanel's `canUndo`/`canRedo` UI refreshes.
- `captureReferenceSnapshot` / `applyReferenceSnapshot` (registered via `StrokeManager.setReferenceRestorer`) handle the capture+restore roundtrip.
- Image-load errors use a separate **non-undoable** `onReferenceResetOnError` path. **Why:** a failed load shouldn't pollute history with an unrecoverable state.
- Reference history is **session-only**, NOT persisted in the autosave draft. **Why:** keeps IndexedDB bounded — after reload only current reference + strokes are restored.

## CanvasRenderer / ViewTransform

- `CanvasRenderer` — stroke rendering with highlight support.
- `ViewTransform` — pinch zoom/pan, scale clamped to **0.25x ~ 8x**.

## DrawingPanel undo button behavior

Undo/redo handles BOTH strokes and reference changes via the same button. Pass parent's `captureReferenceSnapshot` to `StrokeManager.undo/redo` so the restorer can swap back the previous reference.
