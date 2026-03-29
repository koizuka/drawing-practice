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

**SplitLayout** - Root layout with GuideProvider context, connects overlay strokes between panels

**ReferencePanel** - Reference source selection (Sketchfab/Image), toolbar with grid toggle, guide line tools (add/delete/clear), zoom reset, fullscreen toggle

**DrawingPanel** - Drawing tools toolbar (pen, eraser, undo/redo, clear, overlay compare, zoom reset, save, gallery), timer display, canvas. Grid toggle is only on reference panel (synced via context).

**DrawingCanvas** - Main canvas component with:
- DPR-aware rendering
- Apple Pencil stylus detection and palm rejection
- Pinch zoom/pan (touch) and trackpad zoom/scroll (wheel events)
- Grid and guide lines drawn in canvas coordinate space (moves with zoom/pan)

**SketchfabViewer** - Sketchfab API integration:
- Model search by category or keyword via Data API
- Viewer API embedding with screenshot capture ("Fix This Angle")
- Screenshot becomes fixed image for drawing reference

**ImageViewer** - Canvas-based image viewer with zoom/pan, grid/guide overlay, stroke overlay for comparison, and guide line interaction (drag to add, tap to select for deletion)

**Gallery** - Modal gallery showing saved drawings with thumbnails, reference title/author, timestamps, delete, and "Use this reference" to reload the same Sketchfab model

### Drawing System (`src/drawing/`)

- **StrokeManager** - Stroke recording, undo/redo stack, stroke-based eraser (find nearest + delete)
- **CanvasRenderer** - Stroke rendering with highlight support
- **ViewTransform** - Pinch zoom/pan coordinate transformation (scale 0.25x-8x)

### Guide System (`src/guides/`)

- **GuideManager** - Grid settings and arbitrary guide line management
- **GuideContext/useGuides** - Shared state between both panels via React context
- **drawGuides** - Grid and guide line rendering in canvas coordinate space
- Grid and guide lines are in a shared coordinate system between panels

### Storage (`src/storage/`)

- **Dexie.js** wrapping IndexedDB for persistent storage (schema v2)
- Each drawing record: strokes, thumbnail PNG, structured `ReferenceInfo` (title, author, source, sketchfabUid), timestamp, elapsed time
- Gallery shows reference title/author, and "Use this reference" button to reload the same Sketchfab model
- Designed for 1000+ records

### Timer (`src/hooks/useTimer.ts`)

- Auto-starts on first stroke completion
- Pauses when app goes to background (visibilitychange API)
- Resets on clear

### Key Patterns

- **Canvas coordinate space**: Grid, guide lines, strokes, and overlay all share the same coordinate space. Each panel applies its own ViewTransform independently.
- **Initial view sync**: When a reference image is loaded, its dimensions are passed to DrawingCanvas via `fitSize` so both panels start with the same scale, ensuring grid alignment.
- **Grid center line**: The grid line nearest to the image center is drawn thicker as a visual anchor for alignment.
- **Overlay comparison**: Drawing strokes are passed as data (not screenshot) to the reference panel, rendered in the reference panel's coordinate space so grid positions align.
- **DPR handling**: All canvas operations multiply by `window.devicePixelRatio`.
- **Viewport sizing**: Uses `100dvh` instead of `100vh` to handle iPad Safari's dynamic toolbar correctly.

### File Structure

```
src/
├── main.tsx
├── App.tsx
├── index.css
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
│   ├── generateThumbnail.ts
│   └── index.ts
├── hooks/
│   ├── useOrientation.ts
│   ├── useTimer.ts
│   └── useFullscreen.ts
└── test/
    └── setup.ts
```

### Build & Deploy

- **Vite** with React plugin, TypeScript strict mode
- **Vitest** + React Testing Library for unit tests
- **Material-UI** for UI components
- **GitHub Pages** deployment via GitHub Actions
