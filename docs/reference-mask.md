# Reference mask (矩形マスク) — design

## Motivation

Copying while looking at the reference trains "erase the difference" rather than
building an internal model of the form. Occluding part of the reference forces
the user to infer the hidden portion from the visible structure, and the visible
portion doubles as a position/scale anchor, so the eventual comparison shows
shape error rather than placement error.

v1 scope: **user-drawn rectangular masks** on the reference, a **reveal toggle**
for checking the answer, and **clear**. Random/automatic masks, timed hiding
(memory drawing), and "hide everything except a box" (inverted mask) are
follow-ups that reuse the same layer — not part of this change.

## Data model (`src/guides/types.ts`)

```ts
export interface MaskRect {
  id: string; // `mask-${n}`, same id scheme as GuideLine
  /** World coords, normalized: w > 0, h > 0. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideState {
  grid: GridSettings;
  lines: GuideLine[];
  /** Optional for back-compat with persisted drafts. Absent ≡ []. */
  masks?: MaskRect[];
  /**
   * When true the masks are drawn as opaque occluders; when false only their
   * dashed outline is drawn (answer-check / reveal state). Absent ≡ true.
   * Persisted so a reload doesn't silently reveal the answer.
   */
  masksHidden?: boolean;
}
```

- Masks live in the **same world coordinate space** as guide lines and strokes
  (see CLAUDE.md "Shared canvas coordinate space"). They therefore pan/zoom with
  the reference and are flipped by the existing CSS `scaleX(-1)` container
  transform with zero extra code.
- They are **reference occluders**, so they are NOT drawn on `DrawingCanvas` and
  are not part of the stroke undo stack (same as guide lines).
- Persistence rides on the existing `session.guideState` (see `db.ts`). The
  `guideState` type in `db.ts` should widen to `GuideState` (or add the two
  optional fields). **No Dexie schema version bump** is needed — the fields are
  additive and optional; add a comment next to the v17 comment explaining that,
  in the same style.
- `coordMigration.shiftGuideState` must shift `masks[].x/y` by `(dx, dy)`
  alongside lines and the perspective anchor. Add a test.
- Import sanitization: `GuideManager.importState` must tolerate missing/garbage
  `masks` (drop entries with non-finite fields, normalize negative w/h, default
  `masksHidden` to `true`). Mirror the style of `migrateGridSettings`.

## GuideManager (`src/guides/GuideManager.ts`)

```ts
getMasks(): readonly MaskRect[];
addMask(x1, y1, x2, y2): MaskRect;       // normalizes corners → {x,y,w,h}
removeMask(id): boolean;
clearMasks(): void;
getMasksHidden(): boolean;               // default true
setMasksHidden(hidden: boolean): void;
findMaskAt(x, y): MaskRect | null;       // topmost (last-added) containing rect
```

`addMask` rejects degenerate rects: callers pass the screen-space minimum
(`5 / scale`, same threshold `ImageViewer` uses for guide-line drags); the
manager itself only normalizes. Update `importState`'s `nextId` scan so
`mask-N` ids don't collide after restore (extend the existing regex or keep a
separate counter — either is fine, be consistent with `GuideLine`).

## GuideContext (`src/guides/GuideContext.tsx`, `guideContextValue.ts`)

Add to the context value:

```ts
masks: readonly MaskRect[];
masksHidden: boolean;
addMask: (x1, y1, x2, y2) => MaskRect;
removeMask: (id: string) => void;
clearMasks: () => void;
setMasksHidden: (hidden: boolean) => void;
```

All of these are **discrete button/tap actions → non-transient `sync()`**, so
`SplitLayout`'s existing guide-version autosave listener flushes immediately
(matches how add/remove line behave). The in-progress drag rectangle is local
viewer state (like `dragStart`/`dragEnd` in `ImageViewer`) and never touches the
manager, so no transient path is needed. `sync()` must also copy masks and
masksHidden into React state, and `restoreGuides` must pick them up.

## Rendering (`src/guides/drawGuides.ts`)

```ts
export function drawMasks(
  ctx: CanvasRenderingContext2D,
  masks: readonly MaskRect[],
  hidden: boolean,
  scale: number,
  highlightedId?: string | null,
): void;
```

- Caller has already applied the view transform (same contract as `drawGrid`).
- `hidden === true`: fill each rect with an opaque neutral (`#d9d9d9`) and a
  1px (`1 / scale`) slightly darker border. Opaque, not translucent — the point
  is that the content is unreadable.
- `hidden === false`: no fill; dashed outline (`setLineDash([6/scale, 4/scale])`)
  in the guide-line red at lower alpha, so the user still sees which region was
  the exercise while comparing.
- `highlightedId`: draw that rect's border thicker/brighter (used for the tap-to-
  delete feedback described below).
- **Draw order in every viewer**: reference content → `drawMasks` → `drawGrid` →
  `drawGuideLines`. Grid and guide lines stay visible over the mask; that is
  deliberate — the grid is the position anchor the user keeps while the content
  is hidden.

Viewers that must call `drawMasks`: `ImageViewer`, `TraceTemplateViewer`,
`YouTubeViewer` (all three already call `drawGrid`/`drawGuideLines` on an
overlay canvas — insert `drawMasks` right before `drawGrid`). `SketchfabViewer`
renders no guide overlay (iframe) and is out of scope. `PoseViewer`: check
whether it draws guides via the same path; if yes include it, if not leave it.

Also verify that masks are **not** baked into anything that leaves the session:
overlay-compare draws stroke data (fine), Fix-Angle screenshots come from the
Sketchfab iframe (fine), and `exportDrawing` / thumbnails — confirm they don't
re-render the reference overlay canvas. If any path does, exclude masks there.

## Interaction (`GuideInteractionMode`)

`GuideInteractionMode` is declared identically in `ImageViewer.tsx` and
`TraceTemplateViewer.tsx` (and imported by `YouTubeViewer`/`ReferencePanel`).
Add one mode: `'mask'`.

In `'mask'` mode, on the viewers that support it (`ImageViewer`,
`TraceTemplateViewer`; `YouTubeViewer` too if its guide-drag code path is
straightforward to extend — it has the same `add` drag structure):

- **Drag** → live preview rectangle (draw with the same style as a hidden mask
  but at ~50% alpha while dragging) → on release, if the rect exceeds the
  `5 / scale` threshold in both dimensions, call `onAddMask(x1, y1, x2, y2)`.
- **Tap without drag on an existing mask** (release within threshold AND
  `findMaskAt(point)` is non-null at the down point) → `onRemoveMask(id)`.
  This keeps v1 to a single mode with no separate delete mode/confirm step;
  a mis-drawn rect is fixed by tapping it. Tap on empty space does nothing.
- Pinch/pan behaviour: mirror exactly what `'add'` does today (two fingers
  cancel the drag and pinch instead).
- Cursor: `'crosshair'`, same as `'add'`.

Props to add to the viewers: `onAddMask?`, `onRemoveMask?`, plus `masks`,
`masksHidden` for rendering. Follow the existing `onAddGuideLine` /
`onPlaceCenter` prop style and the `GRID_CENTER`-based draw call site.

`ReferencePanel`'s `effectiveGuideMode` logic stays as is; `'mask'` is just
another value of the local `guideMode` state toggled via `toggleGuideMode`.
`suppressGuideEditing` (gesture session) must disable mask editing too — it
already forces the effective mode to `'none'`, so only the toolbar `disabled`
props need adding.

## Toolbar (`ReferencePanel.tsx`)

Add a new button group **after** the guide-line group, separated by the standard
1px divider, shown under the same visibility condition as the guide-line tools
(`(isFixed || isYouTube) && !inYouTubeVideoMode`):

| Button | Icon (lucide-react) | Behaviour |
|---|---|---|
| Add mask (mode toggle) | `SquareDashed` | `toggleGuideMode('mask')`. Active style identical to the guide-line `add` button (`error.main` bg, white icon). |
| Reveal / hide | `Eye` when hidden (tap to reveal), `EyeOff` when revealed (tap to hide) | `setMasksHidden(!masksHidden)`. Rendered only when `masks.length > 0`. Highlight with `color: 'primary.main'` while revealed so the "answer is showing" state is obvious. |
| Clear masks | `SquareX` | `clearMasks()`. Rendered only when `masks.length > 0`. Plain (non-destructive-colored) icon, no confirm — cheap to redo. |

Like the guide-line "clear" escape hatch, also show the Clear-masks button when
no viewer is active but `masks.length > 0`, so stale masks are never
undeletable.

All icon buttons are `IconButton size="small"` wrapped in `ToolbarTooltip`
(see `.claude/rules/ui-design-principles.md`). Do not add a mask entry point on
the drawing panel (masks belong to the reference side — access-symmetry rule).

## i18n (`src/i18n.ts`)

Add en/ja keys: `addMask` ("Add mask" / "マスクを追加"), `revealMasks`
("Reveal hidden areas" / "隠した部分を表示"), `hideMasks` ("Hide again" /
"再び隠す"), `clearMasks` ("Clear all masks" / "マスクをすべて消去").

## Tests (Vitest)

- `GuideManager.test.ts`: add/normalize negative drag, remove, clear, hidden
  toggle default `true`, `findMaskAt` picks last-added on overlap, `importState`
  with missing `masks` / malformed entries / `masksHidden` absent.
- `coordMigration.test.ts`: `shiftGuideState` shifts masks.
- `ImageViewer.test.tsx`: in `'mask'` mode a drag calls `onAddMask` with
  world coords; a tap on an existing mask calls `onRemoveMask`; a sub-threshold
  drag on empty space calls neither. Model on the existing add-guide-line test.
- `ReferencePanel.test.tsx`: mask buttons appear only with a fixed reference;
  reveal/clear appear only with masks; `suppressGuideEditing` disables add.
- A small `drawGuides` test that `drawMasks` with `hidden=false` does not call
  `fillRect` (spy on a mock ctx) and with `hidden=true` does.

## Docs

- Add one sentence about masks to the "Grid modes"/guides area of `CLAUDE.md`
  and a short entry in `.claude/rules/reference-sources.md` (mask layer draw
  order + world-coord invariant + not exported).

## Out of scope (do not implement now, but don't preclude)

- Inverted mask (hide everything outside a rect) — becomes a `kind` field on
  `MaskRect` or a `GuideState.maskInvert` flag later.
- Timed auto-hide after N seconds (memory drawing).
- Random / template-driven masks and per-source presets.
- Normalized (bbox-fitted) overlay compare.

---

# Phase 2 — reference underlay on the drawing canvas + peek

## Motivation

With masks in place, drawing the hidden part in a *separate* panel re-introduces
the placement problem the masks were meant to remove. Phase 2 lets the user draw
directly "inside the frame": the drawing canvas shows the reference faintly
underneath, with the masked rectangles cut out (blank white), so the exercise
becomes "continue the visible structure into the blank". Revealing then shows
the answer directly under the user's strokes.

Two additions:

1. **Underlay** — faint reference image under the strokes on `DrawingCanvas`,
   with masked rects cut out while masks are hidden.
2. **Peek** — press-and-hold on the Eye button reveals masks only while held.

Builds on `feature/reference-mask` (Phase 1); keep everything there intact.

## 1. Underlay

### State

- `underlayEnabled: boolean` lives in `SplitLayout` (not guide state — it is a
  drawing-panel view preference, like `isFlipped`). Default `false`.
- Persisted in `SessionDraft` as optional `underlayEnabled?: boolean`
  (absent ≡ false). Additive field → **no Dexie version bump**; comment next to
  the v17 note like Phase 1 did. Add to `useAutosave` state + `getAutosaveState`
  + draft restore. Toggle = discrete button → immediate flush (bump
  `flushVersion` the way collapse/flip do).
- **Auto-enable**: when `masks.length` transitions 0 → >0 and an underlay image
  is available, set `underlayEnabled = true`. Never auto-disable (the user may
  want to keep tracing after clearing masks). Implement with the same
  prev-value render-time pattern `SplitLayout` uses for `prevGuideVersion`.

### Which image

`SplitLayout` derives `underlayImageUrl: string | null`:

- `source === 'image'` with `referenceMode === 'fixed'` → `localImageUrl`
- `source` in `sketchfab | pose | url | pexels` with `referenceMode === 'fixed'`
  → `fixedImageUrl`
- everything else (`youtube` — cannot draw an iframe; `trace-template` — has its
  own guide-stroke rendering already; `none`; browse modes) → `null`.

Mirror the `isFixed` / `displayImageUrl` logic in `ReferencePanel` (around
line 1081) so the underlay is available exactly when `ImageViewer` is showing a
fixed image. Consider extracting that predicate into
`splitLayoutHelpers.ts` so both sides share it, with a unit test.

### Rendering (`DrawingCanvas`)

New props: `underlayImageUrl?: string | null`, `masks: readonly MaskRect[]`,
`masksHidden: boolean` (threaded through `DrawingPanel`, which already reads
guide state from `useGuides`, so `DrawingPanel` can source `masks` / effective
hidden itself and pass them down).

Image loading: reuse ImageViewer's "try plain, upgrade to CORS" sequence.
Extract it into a shared helper (e.g. `src/utils/loadReferenceImage.ts`,
returning `{ promise, cancel }` or taking an `AbortSignal`) and use it from both
`ImageViewer` and `DrawingCanvas` so the two never diverge. Store the loaded
`HTMLImageElement` in a ref; `requestRedraw()` on load. Clear the ref when the
URL becomes null.

Redraw order (world space, the transform is already applied at that point):

```
renderer.clear()                                   // white background
if (underlayEnabled && image loaded) {
  ctx.save(); ctx.globalAlpha = UNDERLAY_ALPHA;    // 0.25
  ctx.drawImage(img, -W/2, -H/2)                   // W,H = naturalWidth/Height
  ctx.restore();
  if (masksHidden && masks.length) {
    for each mask: ctx.fillStyle = background (#fff); ctx.fillRect(x, y, w, h)
                   thin border 1/scale, rgba(0,0,0,0.25)   // frame the blank
  }
}
template strokes → user strokes → grid → guide lines → trace feedback (unchanged)
```

- World origin ≡ image center, so `-W/2, -H/2` aligns with what `ImageViewer`
  draws and with the strokes — no other alignment code. This holds whether or
  not the reference panel is collapsed (`baseScale` only changes projection).
- Flip: whatever `DrawingCanvas` already does for `isFlipped` applies to the
  whole world-space draw, so the underlay flips with the strokes. Verify.
- The gray Phase 1 occluder is **not** drawn on the drawing side; the cutout is
  background-colored so the blank reads as "draw here".
- When `masks.length === 0` the whole faint image shows (plain tracing use).
- Do NOT touch `exportDrawing` / `generateThumbnail` — they render strokes
  only; confirm after the change that nothing new routes through the drawing
  canvas's pixels.

### Toolbar (`DrawingPanel`)

One toggle in the **view group** (next to reset-zoom), rendered only when
`underlayImageUrl` is non-null:

| Button | Icon | Behaviour |
|---|---|---|
| Underlay | `Layers` (lucide-react) | toggles `underlayEnabled`. Active: `color: 'primary.main'`. |

`IconButton size="small"` in `ToolbarTooltip`. i18n: `underlayShow`
("Show reference underlay" / "手本を下敷きに表示"), `underlayHide`
("Hide reference underlay" / "下敷きを非表示").

## 2. Peek (hold-to-reveal)

### State

- `masksPeeking: boolean` — **non-persisted** UI state in `GuideContext`
  (sibling of `placingCenter`), with `setMasksPeeking`.
- Everywhere a viewer or the drawing canvas receives `masksHidden`, pass the
  **effective** value `masksHidden && !masksPeeking`. Keep the persisted
  `masksHidden` untouched by a peek so no autosave fires and the persisted
  answer-state is unchanged.

### `useLongPress` extension

Add an optional `onLongPressEnd?: () => void` option: fired on `pointerup` /
`pointercancel` **only if `onLongPress` already fired** for that gesture, and
also on unmount if a long press is still active (so a peek can't get stuck).
Existing behaviour unchanged; extend `useLongPress.test.ts`.

### Eye button behaviour

Extract the Phase 1 Eye button into `MaskRevealButton` (props: `masksHidden`,
`onToggle`, `onPeekStart`, `onPeekEnd`) and use `useLongPress` with
`ms ≈ 300`:

- quick tap → `setMasksHidden(!masksHidden)` (Phase 1 toggle, unchanged)
- hold → `setMasksPeeking(true)`; release/cancel → `setMasksPeeking(false)`
- while peeking, show the `EyeOff` icon (same as revealed) so the state is
  visible; disabled when `masks.length === 0` (button is hidden then anyway).
- Set `touch-action: none` / `user-select: none` on the button so iPadOS
  doesn't trigger text-selection or the callout on hold.

### Access symmetry while collapsed

The Eye button lives on the reference toolbar. When the reference panel is
collapsed that toolbar is unreachable, yet the underlay makes collapsed +
masked the natural full-screen mode. Do what `GridModePopoverButton` already
does: render `MaskRevealButton` on the drawing toolbar **only while
`referenceCollapsed && masks.length > 0`**, right after the grid stand-in.
Record the reason inline, referencing ui-design-principles §8.

## Tests

- `DrawingCanvas.test.tsx`: with `underlayEnabled` and a loaded image,
  `drawImage` is called at `(-W/2, -H/2)` with alpha 0.25; masks → `fillRect`
  per mask when hidden, none when revealed; no `drawImage` when disabled.
  (Mock `Image` load the way `ImageViewer.test.tsx` does.)
- `splitLayoutHelpers.test.ts`: underlay-URL predicate per source/mode.
- `SplitLayout.test.tsx`: adding the first mask auto-enables the underlay
  (and does not re-enable after the user turned it off and adds a 2nd mask —
  the trigger is 0 → >0 only); `underlayEnabled` round-trips through autosave.
- `useLongPress.test.ts`: `onLongPressEnd` fires after a fired long press on
  up/cancel, not after a plain click; fires on unmount mid-hold.
- `MaskRevealButton` test: tap toggles; hold → peek start; release → peek end.
- `DrawingPanel.test.tsx`: underlay toggle appears only with a URL; Eye
  stand-in appears only when collapsed with masks.

## Docs

Extend the one-line "Reference masks" entry in `CLAUDE.md` with the underlay
(`underlayEnabled`, drawing-side cutout, peek is non-persisted) and add a
sentence to `.claude/rules/reference-sources.md`.

## Out of scope

Underlay opacity slider; underlay for YouTube / trace templates; auto-hide
timer; inverted masks.
