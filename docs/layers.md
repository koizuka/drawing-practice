# Drawing layers — design

## Motivation

Two workflows want strokes grouped and shown independently:

1. **Draft → ink (this change, phase 1)**: rough lines on a faint blue layer,
   clean lines on top, then hide the draft and save only the ink.
2. **Line animation (phase 2, planned)**: frames × layers. A second,
   orthogonal per-stroke attribute (`frame`) plus onion skin / filmstrip /
   playback. Phase 1 deliberately keeps the model open for that axis — see
   "Phase 2" below.

## Data model (`src/drawing/layers.ts`)

```ts
type LayerColor = 'ink' | 'blue' | 'red';
interface Layer { id; name; visible; opacity /* 0.1–1 */; locked; color }
interface LayerState { layers: Layer[] /* bottom → top, never empty */; activeLayerId }
interface Stroke { points; timestamp; layerId?: string }
```

- **One chronological stroke array** stays in `StrokeManager`. A stroke only
  carries an optional `layerId`; layer order is applied at render time by
  `orderStrokesForRender` (bucket by layer, chronological within a layer,
  hidden layers skipped). **Why:** every existing index-based undo entry
  (`add` pops the last stroke, `delete` / `lasso-delete` splice at stored
  indices) keeps working unchanged — splitting strokes into per-layer arrays
  would have meant rewriting the whole undo machinery.
- `layerId` absent ≡ `DEFAULT_LAYER_ID` (`'base'`). Strokes on the default
  layer are stored without the field, and a single untouched default layer is
  not persisted at all (`isDefaultLayerState`) — plain drawings serialize
  byte-identically to pre-layer data.
- Copy helpers must spread the stroke (`quantizeStroke`, `shiftStroke`) so
  `layerId` (and phase 2's `frame`) survive.
- `MAX_LAYERS = 8`.

## StrokeManager

Layer list + active id live in `StrokeManager` (it is the drawing document).

- `startStroke` tags the new stroke with the active layer.
- **Editable = on the active layer AND the active layer is visible and
  unlocked** (`isStrokeEditable`). `findNearestStroke` (erase tap) and the
  lasso candidate scan in `DrawingCanvas` both honor it, so you can fix the
  ink without touching the draft.
- Pen-down on a hidden/locked active layer is refused in `DrawingCanvas`
  (`canDrawOnActiveLayer`) before `onStrokeStart` — no stroke, no timer start —
  and `onStrokeBlocked` shows a short hint. The toolbar layer button turns
  warning-colored in that state.
- **Undo policy**: only `deleteLayer` is undoable — a `layer-delete` entry
  (layer, its index, its strokes with their array indices, previous active
  id), same shape on both stacks. Undo re-inserts the layer and splices the
  strokes back ascending (indices clamped, since a committed tentative clear
  may have shrunk the array). `commitTentativeClear` / `discardStrokes` filter
  its items like `lasso-delete` but keep the entry (the layer itself is still
  restorable). `clearLayer` reuses `lassoDelete` (one undo unit).
  Settings edits (add / rename / visibility / opacity / lock / color / reorder
  / active) are NOT on the stack — like `masksHidden` they are view-ish, and
  keeping them off means stroke undo never has to reason about a moved layer.
- Gallery-dirty: every layer edit except `setActiveLayer` bumps the mutation
  counter (it changes what a save would write — layers and thumbnail).
- `loadState(strokes, redo, layerState?)`: absent ⇒ default single layer;
  sanitized via `sanitizeLayerState`; strokes on unknown layers are reassigned
  to the bottom layer. Every restore path passes the layer state: draft
  restore, deferred legacy migration (`pendingMigrationRef.layerState`),
  gallery load (`drawing.layers`).
- The trash button (`tentativeClear`) still clears all layers; layers stay.

## Persistence

- Session draft: optional `layers` / `activeLayerId` (written only when
  non-default). A layer-only setup (no strokes, no reference) still keeps the
  draft alive.
- Gallery record: optional `layers` (non-default only). All strokes are saved —
  hidden layers included — so the drawing stays re-editable.
- No Dexie version bump: all fields are additive and unindexed (comment next
  to v17 in `db.ts`).

## Rendering consumers

| Consumer | Behavior |
|---|---|
| `DrawingCanvas` | layer order, tint, opacity (× trace dim); in-progress stroke in the active layer's style |
| Thumbnail / export (SVG, PNG, JPEG, gallery preview) | `renderItemsForStoredDrawing`: visible layers with tint/opacity; if every layer is hidden, render all (never export a blank) |
| Overlay compare, `CanvasNavigator` | visible strokes only, untinted |
| Trace scoring | unchanged — it scores the just-committed stroke, which is on the active layer |

Opacity is applied per stroke (overlaps darken slightly) rather than via an
offscreen layer composite — cheaper, and indistinguishable for line art.

## UI (`LayerPopoverButton`)

Drawing toolbar, next to pen/eraser (the active layer decides where the pen
draws). Badge = active layer number when >1 layer. Popover: list top-first
(row = select; eye; lock; tint dot; name; stroke count), "Add layer",
"Draft + Ink" preset (single-layer only: base → blue 50% "Draft", new "Ink"
on top; the ink layer becomes active only if something was already drawn),
then active-layer settings (name, color, opacity slider, up/down, clear-layer
and delete-layer with in-place ✓/✗ confirm; deleting an empty layer skips the
confirm). Slider drag / typing use the debounced autosave; discrete edits
flush.

## Phase 2 (animation) — planned

- `Stroke.frame?: number` (absent ≡ 0), `Layer.animated?: boolean` (false ⇒
  shown on every frame, e.g. background), session `frameCount` / `fps` / onion
  settings.
- Render filter = layer visible ∧ (¬animated ∨ frame = current); onion skin =
  ±N frames of animated layers in red/blue at low alpha.
- Editable additionally requires `frame === currentFrame` for animated layers.
- Frame insert / delete / duplicate need undo entries (renumber `frame`).
- Filmstrip + scrub bar + play/pause at the bottom of the drawing panel.
