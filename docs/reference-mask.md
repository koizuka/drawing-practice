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
