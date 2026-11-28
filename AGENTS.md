# AGENTS.md

Guidance for coding agents (Codex, Antigravity / `agy`, etc.) when working in this repository.

## Project

Drawing Practice is an iPad + Apple Pencil focused line-drawing practice app. The screen is split between a reference viewer and a drawing canvas, with shared grid / guide alignment. References include Sketchfab models, images, YouTube videos, Pexels photos, bundled trace templates, and an AI-posed 3D mannequin; trace templates score strokes against target shapes and show red deviation feedback.

Live app: https://koizuka.github.io/drawing-practice/

## Commands

```bash
npm run dev              # Development server
npm run build            # Type-check + production build
npm run preview          # Preview production build
npm run lint             # Lint (oxlint) + format check (oxfmt --check)
npm run format           # Format with oxfmt
npm run test             # Run tests once
npm run test:watch       # Run tests in watch mode
npm run extract-pose-rig # Regenerate pose harness rig fixture from public/mannequin.vrm
```

Prefer `npm run test` over watch mode in agent / CI-style runs.

## Stack

- Vite + React + TypeScript 7 (strict mode)
- Material UI
- oxlint + oxfmt
- Vitest + React Testing Library
- Dexie / IndexedDB schema v16 for persistence
- GitHub Pages via GitHub Actions

## Code Map

- `src/components/SplitLayout.tsx`, `src/components/splitLayoutHelpers.ts`: top-level state owner for reference, timer, autosave, undoable reference changes, panel collapse, shared `StrokeManager`, underlay, and restore gating
- `src/components/ReferencePanel.tsx`: reference source selection and reference-side toolbar
- `src/components/DrawingPanel.tsx`: drawing-side toolbar, timer, undo/redo, save, gallery, layers, animation timeline
- `src/components/DrawingCanvas.tsx`: drawing input, rendering, zoom/pan/rotation, grid/guide/underlay rendering
- `src/components/CanvasNavigator.tsx`: world-up reset button, rotation step controls, and transient overview disc
- `src/components/PerspectiveController.tsx`: floating perspective-grid controller (rotation pad, strength/size sliders, anchor placement, angle memories)
- `src/components/LayerPanel.tsx`: non-modal corner-docked drawing layer panel
- `src/components/AnimationTimeline.tsx`: frame timeline, onion skin, playback, export, and YouTube rotoscope sync toggle
- `src/components/SketchfabViewer.tsx`: Sketchfab browsing, embed, fix-angle capture
- `src/components/ImageViewer.tsx`: image reference viewer with shared overlays
- `src/components/YouTubeViewer.tsx`: YouTube iframe viewer with overlay-based interaction model and rotoscope sync bridge
- `src/components/PexelsSearcher.tsx`: Pexels search UI and selection flow
- `src/components/TraceTemplateViewer.tsx`, `src/components/BundledTemplatePicker.tsx`: trace template viewing, browsing, and scoring flows
- `src/components/PoseSourcePanel.tsx`: sketch / text-to-pose flow, VRM mannequin viewer, generated-pose history, and fix-angle capture
- `src/components/Gallery.tsx`: saved drawing gallery, export, reload reference, storage summary
- `src/drawing/StrokeManager.ts`: shared undo/redo history for strokes, reference changes, layers, and animation frames
- `src/drawing/layers.ts`, `frames.ts`, `docState.ts`: layer rendering/ordering, frame definitions, and combined storage state
- `src/drawing/rotation.ts`, `navigator.ts`: view-rotation math and navigator overview helpers
- `src/guides/`: grid / guide / mask shared state and rendering (`perspective.ts` for room/box/Loomis-head projection)
- `src/trace/TraceScoringContext.tsx`: shared trace-template scoring state
- `src/trace/`, `src/templates/`: trace template definitions, scoring, and bundled assets
- `src/pose/`: pose prompts and JSON sanitizing, joint mapping / IK, geometric validation, headless harness, and bounded refinement loop
- `src/storage/`: IndexedDB schema, draft persistence, URL history, image/animation export (`exportAnimation.ts`), storage accounting
- `src/hooks/useTimer.ts`, `useAutosave.ts`, `useReferenceState.ts`, `useUrlReferenceLoader.ts`: timer, debounced draft persistence, reference state, and URL/history loading
- `src/utils/youtube.ts`, `pexels.ts`, `sketchfab.ts`, `gifEncoder.ts`, `videoSyncBridge.ts`: source helpers, in-house GIF89a encoder, and rotoscope video sync bridge

## Architectural Rules

- Keep the reference panel and drawing panel in the same logical coordinate space. Grid, guides, reference masks, overlay strokes, and fit sizing must stay aligned across both panels.
- Shared camera state is a `ViewTransform` model: `viewCenter` in world coordinates plus `zoom` and `rotation`, projected into each panel with its own `baseScale`. Pan / zoom should survive UI navigation and reset only on actual content load via the fitting viewer.
- View rotation ("rotate the paper") applies **only to the drawing panel**; reference viewers stay upright. Pinch rotation is behind a toolbar switch; keys `4` / `6` / `5` rotate/reset. CSS horizontal flip negates screen-direction rotation inputs and readouts.
- Split layout switches between side-by-side and stacked panels by orientation. The reference panel can be collapsed for free drawing from the drawing toolbar, and that collapsed state is autosaved.
- `drawingFitSize` must be derived from `fitLeader`, not raw `referenceSize`; source pickers and search screens may still have stale reference dimensions.
- World origin is the grid center. References are rendered centered at `(0, 0)`, and stored strokes / guides use `coordVersion` migration for legacy data.
- Grid modes (`none` / `normal` / `large` / `perspective`) include 3D perspective forms (`room`, `box`, `head`). `PerspectiveController` mid-drag edits sync with `transient: true` (2s debounce), while pointer-up flushes immediately; angle memories are capped at 9.
- Reference masks (`GuideState.masks` / `masksHidden`) live in world coordinates and are never baked into exports/thumbnails. Optional drawing underlay (`SplitLayout.underlayEnabled`) renders fixed-image references only (never YouTube or trace templates) at 25% alpha with hidden masks cut out in background color; hold-to-peek (`masksPeeking`) is never persisted.
- Drawing layers (`StrokeManager` layer list + active layer) keep strokes in one chronological array with optional `layerId` (absent ≡ `'base'`). Animation frames add an orthogonal `frameId` axis (absent ≡ `'frame-0'`, with `Layer.shared` appearing on all frames), persisted together via `docStateForStorage`. Animation export uses the in-house GIF89a encoder (`src/utils/gifEncoder.ts`, intentionally zero npm deps). YouTube rotoscope sync drives the player via `VideoSyncBridge`.
- Reference mutations should flow through `SplitLayout.changeReference(mutate, opts?)` so they are captured in undo history, pause the timer, and bump history sync state. Use `{ recordUndo: false }` only for intentionally non-undoable flows such as rapid gesture-driven photo advancement. Image-load errors use the separate non-undoable reset path.
- Undo/redo history covers strokes, reference changes, and stroke-removing layer/frame operations. When changing reference, layer, or frame behavior, verify undo/redo semantics.
- Autosave persists the current session state, but reference undo history is intentionally session-only and not restored after reload.
- `SplitLayout` intentionally gates panel rendering until draft restore is complete or no session lock exists. Do not replace this with hidden-but-mounted panels; first-paint toolbar transitions are user-visible.
- Autosave uses a 2s debounce for freehand stroke commits, immediate flush for reference changes and discrete UI actions (including stroke-edit buttons), and a short camera tail-debounce. Camera home / unfit adjustment paths intentionally suppress autosave.
- Timer behavior is user-visible product logic. Reference changes, save, gallery open, backgrounding, and fully undoing strokes all affect timer state.
- IndexedDB usage matters. Prefer bounded history, quantized persisted stroke data, and reuse of existing storage helpers.
- Canvas work must account for `window.devicePixelRatio`, and viewport sizing should use `100dvh` rather than `100vh` for iPad Safari.
- The Apple Pencil input-freeze investigation is resolved: WebKit / iPadOS can suspend page-wide input delivery while rAF and the main thread remain alive; see `docs/apple-pencil-input-freeze.md` and `DrawingFreezeHint`. The `?diag=touch` diagnostics harness used for that investigation has been removed (recoverable from git history).

## Detailed Rule Documents

Path-scoped product and behavioral rules live in `.claude/rules/` (canonical source of truth):

- `drawing-undo.md`: `src/drawing/**`, `SplitLayout.tsx`, `DrawingPanel.tsx`
- `timer-autosave.md`: `useTimer.ts`, `useAutosave.ts`, `SplitLayout.tsx`
- `reference-sources.md`: reference viewers, searchers, and source utilities
- `storage.md`: `src/storage/**` and storage accounting / history behavior
- `gallery.md`: `Gallery.tsx`, export, and restored-reference flows
- `ui-design-principles.md`: `src/components/**` UI structure and interaction patterns
- `trace-template.md`: `src/trace/**`, `src/templates/**`, `TraceTemplateViewer.tsx`, `BundledTemplatePicker.tsx`

Antigravity (`agy`) loads these automatically on matching file globs via `.agents/rules/*.md` wrappers (`@[...]` includes). Agents that do not load `.agents/rules/` (such as Codex) should read the matching `.claude/rules/*.md` file directly before changing those areas. Keep `AGENTS.md` as the stable high-level map, treat `.claude/rules/` as the detailed source of truth, and keep `.agents/rules/` in sync if rule files or their scoped paths change.

## Reference Source Notes

- URL input auto-detects YouTube, Pexels, and Sketchfab URLs and routes them into dedicated flows rather than treating everything as a plain image URL.
- Sketchfab "Fix This Angle" captures a screenshot that becomes the fixed reference and also the persisted thumbnail for gallery / history restore.
- YouTube supports playback interaction through an overlay mode switch; still-frame capture is intentionally unsupported.
- Pexels API keys are user-supplied and stored in `localStorage['pexelsApiKey']`; never bundle a key.
- Local images and Sketchfab screenshots are stored in URL history so references can be restored later.
- Trace template replacement / undo semantics are path-specific; read `trace-template.md` before changing template state, scoring, or bundled template behavior.
- The `pose` source accepts a rough figure sketch and/or a text hint, calls the Anthropic Claude API directly from the browser using the user's `localStorage.getItem('anthropicApiKey')` value, and applies semantic pose JSON to a three.js / three-vrm mannequin. Never bundle an API key.
- Pose limbs may use angles or placement targets (`handAt`, `footAt`, `kneeAt`, `elbowAt`, and `body.hipsHeight`) solved by analytic two-bone IK. Generated poses are geometrically validated and may be refined in the same model conversation for at most two rounds. Prompt recipe coordinates must be machine-verified via the headless harness (`docs/pose-headless-loop.md`, `npm run extract-pose-rig`).
- Pose "Fix This Angle" uses the standard fixed-image path. User-loaded VRMs are stored in `poseAssets`; successful generations are stored in the capped, LRU-managed `poseHistory` and can be reapplied. Inverted-pose hair behavior is a VRM spring-bone model trait; see `docs/vrm-springbone-gravity.md`.

## Storage Notes

- Main persisted entities are `drawings`, `session`, `urlHistory`, `pexelsSearchHistory`, `sketchfabSearchHistory`, `poseAssets`, and `poseHistory`.
- `drawings` stores quantized strokes for size control. Do not accidentally apply that quantization to in-memory editing behavior.
- `session` is the autosave draft.
- `urlHistory` is split-capped so image-heavy usage does not evict all non-image history.
- `poseHistory` stores pose JSON, hint, and thumbnail, and is capped at 50 entries using LRU eviction.
- Database name is scoped by `BASE_URL` so preview deployments do not share data with production. Main uses `DrawingPracticeDB`; previews use `DrawingPracticeDB_{basePath}` and have cleanup behavior for stale preview DBs.

## Working Style

- Prefer minimal, local changes that preserve current interaction patterns.
- For behavior changes, inspect the owning component and the relevant storage / hook / utility modules together before editing.
- When touching reference flows, check `SplitLayout`, `ReferencePanel`, `StrokeManager`, and the relevant source utility.
- When touching persistence, check both the Dexie schema and all read/write call sites.
- When working in an area covered by `.claude/rules/`, ensure the matching rule document has been read alongside the code before editing.
- Run `npm run lint` after meaningful code changes. Run targeted tests when behavior is covered by tests; add tests when the changed logic is isolated enough to justify them.

## Project Skills

Shared skills in `.agents/skills/` are discovered by both Codex and Antigravity (`agy`):

- `.agents/skills/create-pr`: check, branch, commit, push, and open a PR for the current changes.
- `.agents/skills/merged`: switch back to `main`, pull, delete the merged local branch, and prune stale remote refs.
- In Codex, invoke explicitly with `$create-pr` or `$merged` (or via the Codex app slash command list). In Antigravity (`agy`), ask naturally (e.g. "PRにして", "マージした") or name the skill directly.

## When In Doubt

- Read code over relying on this file. This document is only a map of stable constraints and entry points.
