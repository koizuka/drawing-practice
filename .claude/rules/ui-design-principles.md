---
paths:
  - "src/components/**"
---

# UI design principles

These principles are the basis for layout and component-choice decisions across `src/components/**`. They were extracted from the existing patterns in the codebase (Drawing/Reference panels, Sketchfab/Pexels/YouTube/Image viewers, Gallery) so future work can stay consistent.

When a new UI is added or an existing one is changed, check it against these principles. If a deliberate deviation is needed, record the reason inline near the code so the next reader understands why.

## 1. Layout skeleton

- The full screen is the **two-panel `SplitLayout`** (Reference / Drawing). Each panel is a vertical flex container: **40px-high top toolbar + content area below**. The viewport uses `100dvh` (required for iPad Safari's dynamic toolbar).
- Toolbar shape: `display: 'flex', height: 40, alignItems: 'center', gap, borderBottom`. Order from left to right:
  1. Close / title
  2. Function-button group(s), separated by 1px vertical dividers (`Box sx={{ width: '1px', height: 24, bgcolor: '#ddd' }}`)
  3. `flex: 1` spacer
  4. View / navigation button group (grid, flip, zoom-reset, fullscreen, gallery, etc.)
- **Exception**: DrawingPanel の reference-collapse トグルだけは toolbar の **左端** (Close/title 相当の位置) に置く。横長レイアウトでドローパネルが画面右側にあるため、左端がそのままリファレンス/ドローイング境界の真横になり、`PanelLeftOpen/Close` のアイコン方向とも一致するため。縦長でも同じ位置に置くことで、orientation を切り替えてもユーザーがトグル位置を覚えやすくする。

## 2. The three-tier button model

| Tier | Use | Component | Style |
|---|---|---|---|
| Toolbar action | In-panel mode/view controls | `IconButton size="small"` wrapped in `ToolbarTooltip` | Icon only. Active=`primary.main`, destructive=`error.main`, warning=`warning.main`, info=`info.main` |
| Primary action | "Execute" buttons inside content (Search, Load More) | `Button size="small" variant="contained"` (or `"outlined"` for secondary) | Text + optional icon |
| Source / navigation | Reference-empty source picker | `Button fullWidth` with icon and left-aligned label | Stacked vertically, identical styling |

Always wrap toolbar `IconButton`s in `ToolbarTooltip` — never bare `Tooltip`. The wrapper handles touch-device behavior consistently.

## 3. Stateful selection vs stateless shortcut (important)

This is the rule that resolves "should this be a `Button` or a `Chip`?".

- **Stateful** (the chosen value is held in state and visible in the UI; selection is exclusive):
  - 2–4 mutually exclusive filters → `ToggleButtonGroup size="small"` (e.g. Sketchfab time filter, Pexels orientation filter, Gallery sort mode)
  - 5+ exclusive filters with dynamic count → row of `Button variant="contained" / "outlined"` (active = `contained`). **Always provide an "All" / escape-hatch button** so users can clear the active selection (see Sketchfab Categories `handleClearCategory`).
- **Stateless** (click executes an action and the button doesn't track selection):
  - Quick-search presets, related-term suggestions → `Chip size="small" variant="outlined"` (e.g. Pexels Suggested chips)

Same visual element, different roles → use different components. Same role across viewers → use the same component.

## 4. Dialog / overlay / inline confirmation

- **Inline (default)**: ordinary controls live inside the panel.
- **Modal** (`position: 'fixed'`, z-index 1000): only for UI that **interrupts the workflow / replaces the screen** (currently Gallery, Settings, ApiKey dialog).
- **Transient confirmation** (delete confirm, etc.): do NOT open a modal. Replace the relevant button group in the toolbar in-place (see DrawingPanel's Save/Gallery ↔ Delete/Cancel pattern). Keeps the user's spatial context.

## 5. Error / notification severity mapping

| Situation | Treatment |
|---|---|
| Configuration blocker requiring user action (API key missing, etc.) | `Alert severity="info"` with an action button |
| Recoverable runtime error (search failed, image failed to load) | `Alert severity="error"` |
| In progress | `CircularProgress` centered with `display: 'flex', justifyContent: 'center', my: 2`. For full-region overlays (e.g. iframe loading), use `position: 'absolute', inset: 0` with a translucent background |
| Lightweight transient status (script/API still warming up) | `Typography variant="body2" color="text.secondary"` is acceptable |

## 6. Autocomplete + history-dropdown convention

- Use `Autocomplete` with `freeSolo` and `size="small"`. **Do not enable `openOnFocus`** — focus alone opening the dropdown is surprising, especially on screens that auto-focus the input on mount (Sketchfab/Pexels search), and it would force every entry into the screen to begin with the popper covering the page. Past-search discoverability is preserved through (1) explicit click on the input, (2) the right-edge dropdown arrow, (3) typing, and (4) ↑/↓ arrow keys — all MUI defaults.
- Auto-focus the search input on entry (Sketchfab/Pexels search screens do this via `inputRef` + a one-shot `useEffect`). Combined with the no-`openOnFocus` rule, this gives keyboard users a ready-to-type field without the dropdown obscuring it.
- Each row: `<query text> / optional metadata Chip / Trash2 IconButton (delete)`, gap 8.
- The delete `IconButton` must call `stopPropagation` on **both** `onPointerDown` and `onClick` — touch devices commit option selection on `pointerdown` before `click` fires.
- Enter submits if the query is non-empty; empty query is a no-op.

## 7. Result grid

- `display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(N, 1fr))', gap: 1`.
- Card: `border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden'`, hover `borderColor: 'primary.main'`, `cursor: 'pointer'`.
- `N` (min column width) is allowed to vary by content type — Sketchfab thumbs use 120px, Pexels photos use 160px. Don't unify these unless there's a reason.

## 8. Access symmetry — when to add an entry point on both panels

When you add a major operation, consciously decide whether it should be reachable from both panels.

The current asymmetries are **deliberate role separations**, not oversights:

- **Gallery entry exists only in DrawingPanel** — the drawing side owns the user's session output, so navigating to "previously saved drawings" belongs there.
- **Guide-line operations exist only in ReferencePanel** — guides are anchored to the reference's coordinate space.
- **"Use this reference" exists only inside Gallery** — it's a navigation choice from a record, not a panel-resident operation.

Follow this rule for new additions: if an operation conceptually belongs to one side's role, do not duplicate it on the other side.
