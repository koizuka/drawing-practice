# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Drawing Practice is a line-drawing practice tool designed for iPad + Apple Pencil. Users view a reference (3D model from Sketchfab or local image) on one side and draw on the other side, with synchronized grid and guide lines for alignment.

**Live deployment**: https://koizuka.github.io/drawing-practice/

## Common Commands

```bash
npm run dev        # Development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run lint       # Lint the codebase
npm run test       # Run tests
npm run test:watch # Run tests in watch mode
```

## Architecture

### Screen Layout

- **Split layout**: Two equal panels, landscape (left/right) or portrait (top/bottom), auto-switching
- **Reference Panel** (left/top): Sketchfab 3D model viewer or local image, with grid overlay
- **Drawing Panel** (right/bottom): Canvas for drawing with pen/eraser tools, with grid overlay

### Key Components

**SplitLayout** - Root layout with GuideProvider context, connects overlay strokes between panels. Manages lifted reference state (source, mode, image URLs), timer, and autosave/restore flow. Inner component (`SplitLayoutInner`) uses `useAutosave` hook for debounced draft persistence.

**ReferencePanel** - Reference source selection (Sketchfab/Local File/URL), toolbar with grid toggle, guide line tools (add/delete/clear), zoom reset, fullscreen toggle. Reference state (source, mode, image URLs) is controlled by parent via props.

**DrawingPanel** - Drawing tools toolbar (pen, eraser, undo/redo, clear, overlay compare, zoom reset, save, gallery), timer display, canvas. Timer and grid toggle are provided by parent (SplitLayout).

**DrawingCanvas** - Main canvas component with:
- DPR-aware rendering
- Apple Pencil stylus detection and palm rejection
- Pinch zoom/pan (touch) and trackpad zoom/scroll (wheel events)
- Grid and guide lines drawn in canvas coordinate space (moves with zoom/pan)

**SketchfabViewer** - Sketchfab API integration:
- Model search by category or keyword via Data API
- Viewer API embedding with screenshot capture ("Fix This Angle")
- Screenshot becomes fixed image for drawing reference

**ImageViewer** - Canvas-based image viewer with zoom/pan, grid/guide overlay, stroke overlay for comparison, and guide line interaction (drag to add, tap to select for deletion). Loads images with non-CORS fallback for cross-origin URLs.

**Gallery** - Modal gallery showing saved drawings with thumbnails, reference title/author, timestamps, delete, and "Use this reference" to reload the same Sketchfab model

### Drawing System (`src/drawing/`)

- **StrokeManager** - Stroke recording, undo/redo stack, stroke-based eraser (find nearest + delete)
- **CanvasRenderer** - Stroke rendering with highlight support
- **ViewTransform** - Pinch zoom/pan coordinate transformation (scale 0.25x-8x)

### Guide System (`src/guides/`)

- **GuideManager** - Grid settings and arbitrary guide line management
- **GuideContext/useGuides** - Shared state between both panels via React context
- **drawGuides** - Grid and guide line rendering in canvas coordinate space
- Grid has 3 modes (`GridMode`): `none` (off), `normal` (100px spacing), `large` (200px spacing), cycled by button click
- Grid lines are anchored to the center point (image center or viewport center) so center lines always align
- Grid and guide lines are in a shared coordinate system between panels

### Storage (`src/storage/`)

- **Dexie.js** wrapping IndexedDB for persistent storage (schema v3)
- Database name is scoped by `BASE_URL` to isolate PR preview deployments. Main deployment uses `DrawingPracticeDB`; PR previews use `DrawingPracticeDB_{basePath}`.
- On main deployment startup, stale PR preview databases are automatically cleaned up via `indexedDB.databases()`.
- `drawings` table: each record has strokes, thumbnail PNG, structured `ReferenceInfo` (title, author, source, sketchfabUid), timestamp, elapsed time
- `session` table: singleton draft record for autosave (strokes, redo stack, reference state, guide state, timer elapsed)
- **sessionStore** - Draft CRUD: `saveDraft`, `loadDraft`, `clearDraft`
- Gallery shows reference title/author, and "Use this reference" button to reload the same Sketchfab model
- Designed for 1000+ records

### Timer (`src/hooks/useTimer.ts`)

- Auto-starts on first stroke completion, resumes on next stroke after any pause
- Pauses on: app backgrounded (visibilitychange API), save, opening the gallery, and any reference change (source / mode / fixed image / local image / Sketchfab angle / gallery "use this reference"). Reference-related pausing is wired through a `pauseAndIncrementVersion` helper in `SplitLayout` that the reference tracked setters share.
- Resets on clear
- `restore(ms)` sets elapsed time without starting (used by autosave restore)

### Autosave (`src/hooks/useAutosave.ts`)

- Debounced (2s) persistence of session state to IndexedDB `session` table
- Tracks changes via a version counter incremented by state setters in SplitLayout
- Suppressed during draft restore to avoid overwriting with partial state
- Clears draft when session is empty (no strokes and no reference)

### Key Patterns

- **Canvas coordinate space**: Grid, guide lines, strokes, and overlay all share the same coordinate space. Each panel applies its own ViewTransform independently.
- **Initial view sync**: When a reference image is loaded, its dimensions are passed to DrawingCanvas via `fitSize` so both panels start with the same scale, ensuring grid alignment.
- **Grid center line**: Grid is anchored to the exact center point (image center or viewport center when no reference is loaded). The center grid line is drawn thicker as a visual anchor for alignment.
- **Overlay comparison**: Drawing strokes are passed as data (not screenshot) to the reference panel, rendered in the reference panel's coordinate space so grid positions align.
- **DPR handling**: All canvas operations multiply by `window.devicePixelRatio`.
- **Viewport sizing**: Uses `100dvh` instead of `100vh` to handle iPad Safari's dynamic toolbar correctly.
- **Autosave/Restore**: Session state (strokes, redo stack, reference, guides, timer) is persisted to IndexedDB on change. On reload, state is restored from draft. Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.

### File Structure

```
src/
├── main.tsx
├── App.tsx
├── index.css
├── types.ts                # Shared types (ReferenceSource, ReferenceMode)
├── components/
│   ├── SplitLayout.tsx
│   ├── ReferencePanel.tsx
│   ├── DrawingPanel.tsx
│   ├── DrawingCanvas.tsx
│   ├── SketchfabViewer.tsx
│   ├── ImageViewer.tsx
│   └── Gallery.tsx
├── drawing/
│   ├── types.ts
│   ├── StrokeManager.ts
│   ├── CanvasRenderer.ts
│   ├── ViewTransform.ts
│   └── index.ts
├── guides/
│   ├── types.ts
│   ├── GuideManager.ts
│   ├── GuideContext.tsx
│   ├── useGuides.ts
│   ├── drawGuides.ts
│   └── index.ts
├── storage/
│   ├── db.ts
│   ├── drawingStore.ts
│   ├── sessionStore.ts     # Autosave draft CRUD
│   ├── generateThumbnail.ts
│   └── index.ts
├── hooks/
│   ├── useOrientation.ts
│   ├── useTimer.ts
│   ├── useAutosave.ts      # Debounced session autosave
│   └── useFullscreen.ts
└── test/
    └── setup.ts
```

### Build & Deploy

- **Vite** with React plugin, TypeScript strict mode
- **Vitest** + React Testing Library for unit tests
- **Material-UI** for UI components
- **GitHub Pages** deployment via GitHub Actions
