import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  ListChecks,
  Clapperboard,
  Copy,
  Download,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import type { StrokeManager } from '../drawing/StrokeManager';
import { FPS_OPTIONS, MAX_FRAMES, formatVideoTime } from '../drawing/frames';
import { exportLiveAnimation, type AnimationExportKind } from '../storage/exportAnimation';
import { orderStrokesForRender } from '../drawing/layers';
import { STROKE_WIDTH } from '../drawing/constants';
import type { Stroke } from '../drawing/types';

// Select-mode drag: how close to a strip edge starts nudging it, and by how much.
const EDGE_SCROLL_PX = 28;
const EDGE_SCROLL_STEP = 16;
const THUMB_W = 64;
const THUMB_H = 48;

interface Box2 {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** One filmstrip cell: the frame's visible strokes, drawn into a common world box. */
const FrameThumb = memo(function FrameThumb({
  strokes,
  colors,
  box,
}: {
  strokes: readonly Stroke[];
  colors: readonly { color: string; opacity: number }[];
  box: Box2 | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = THUMB_W * dpr;
    canvas.height = THUMB_H * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!box || strokes.length === 0) return;
    const scale = Math.min((THUMB_W * dpr) / box.width, (THUMB_H * dpr) / box.height);
    const ox = (THUMB_W * dpr - box.width * scale) / 2;
    const oy = (THUMB_H * dpr - box.height * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox - box.minX * scale, oy - box.minY * scale);
    // Keep lines legible at thumbnail scale (at least ~1 device px).
    ctx.lineWidth = Math.max(STROKE_WIDTH, dpr / scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach((s, i) => {
      if (s.points.length < 2) return;
      ctx.strokeStyle = colors[i].color;
      ctx.globalAlpha = colors[i].opacity;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let k = 1; k < s.points.length; k++) ctx.lineTo(s.points[k].x, s.points[k].y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }, [strokes, colors, box]);
  return (
    <canvas ref={ref} style={{ width: THUMB_W, height: THUMB_H, display: 'block' }} aria-hidden />
  );
});

/**
 * Per-frame thumbnail data + one shared world box so motion reads correctly
 * across cells (pure; recomputed by the caller when the drawing changes).
 */
function computeFrameThumbs(strokeManager: StrokeManager) {
  const strokes = strokeManager.getStrokes();
  const layers = strokeManager.getLayers();
  // The union over frames == all visible strokes, so walk points once (not
  // per frame — shared-layer strokes appear in every frame).
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const it of orderStrokesForRender(strokes, layers)) {
    for (const p of it.stroke.points) {
      if (p.x < bb.minX) bb.minX = p.x;
      if (p.y < bb.minY) bb.minY = p.y;
      if (p.x > bb.maxX) bb.maxX = p.x;
      if (p.y > bb.maxY) bb.maxY = p.y;
    }
  }
  const perFrame = strokeManager.getFrames().map((frameId) => {
    const items = orderStrokesForRender(strokes, layers, strokeManager.getFrameView(frameId));
    return {
      frameId,
      strokes: items.map((i) => i.stroke),
      colors: items.map((i) => ({ color: i.color, opacity: i.opacity })),
    };
  });
  let box: Box2 | null = null;
  if (bb.minX !== Infinity) {
    const w = Math.max(1, bb.maxX - bb.minX);
    const h = Math.max(1, bb.maxY - bb.minY);
    const pad = Math.max(w, h) * 0.06;
    box = { minX: bb.minX - pad, minY: bb.minY - pad, width: w + pad * 2, height: h + pad * 2 };
  }
  return { perFrame, box };
}

interface AnimationTimelineProps {
  strokeManager: StrokeManager;
  /** Bumped by the parent on every drawing change (drives thumbnail refresh). */
  contentVersion: number;
  playing: boolean;
  /** Frame index shown right now (the playback position while playing). */
  displayIndex: number;
  onTogglePlay: () => void;
  /** Select a frame for editing. `transient` = mid-scrub (debounced autosave). */
  onSelectFrame: (frameId: string, opts?: { transient?: boolean }) => void;
  /** After a structural frame edit (add / duplicate / move / delete / fps). */
  onChanged: () => void;
  onionRange: number;
  onOnionRangeChange: (range: number) => void;
  /**
   * Rotoscope toggle — present only while the reference is a YouTube video.
   * `time` = video moment of the shown frame while synced.
   */
  videoSync?: { active: boolean; canEnable?: boolean; time: number | null; onToggle: () => void };
}

/**
 * Animation timeline under the drawing canvas (docs/layers.md "Frames"):
 * transport + scrub slider + fps + onion skin on the first row, a thumbnail
 * filmstrip with frame operations on the second.
 */
export function AnimationTimeline({
  strokeManager,
  contentVersion,
  playing,
  displayIndex,
  onTogglePlay,
  onSelectFrame,
  onChanged,
  onionRange,
  onOnionRangeChange,
  videoSync,
}: AnimationTimelineProps) {
  const frames = strokeManager.getFrames();
  const currentId = strokeManager.getCurrentFrameId();
  const currentIndex = strokeManager.getCurrentFrameIndex();
  const n = frames.length;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // A pending confirm belongs to the moment it was asked: drop it as soon as
  // the current frame changes (render-time prev-prop pattern, no effect) so
  // coming back to that frame later doesn't resurrect it.
  const [prevCurrentId, setPrevCurrentId] = useState(currentId);
  if (prevCurrentId !== currentId) {
    setPrevCurrentId(currentId);
    if (confirmDeleteId !== null) setConfirmDeleteId(null);
  }
  const pendingDelete = confirmDeleteId === currentId;
  const stripRef = useRef<HTMLDivElement>(null);

  // ---- Select mode (bulk delete) ----
  // Tap toggles a frame; dragging across the strip paints a range (adding
  // when it started on an unselected frame, removing otherwise); shift-click
  // extends from the last anchor. Thumbnails don't navigate in this mode.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const dragRef = useRef<{ anchor: number; add: boolean; base: ReadonlySet<string> } | null>(null);
  // Shift-click anchor: state (not a ref) so leaving select mode can reset it
  // from render-time code.
  const [lastAnchor, setLastAnchor] = useState<number | null>(null);
  // Ids of deleted / undone-away frames simply drop out here.
  const selected = frames.filter((f) => selectedIds.has(f));
  // State only, so it is callable during render. (dragRef needs no reset: it
  // is cleared on every pointer up / cancel.)
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmBulk(false);
    setLastAnchor(null);
  };
  // Playback takes over the strip — leave select mode (render-time pattern).
  if (playing && selectMode) exitSelectMode();
  const paintRange = (from: number, to: number, add: boolean, base: ReadonlySet<string>) => {
    const next = new Set(base);
    for (let k = Math.min(from, to); k <= Math.max(from, to); k++) {
      const id = frames[k];
      if (!id) continue;
      if (add) next.add(id);
      else next.delete(id);
    }
    setSelectedIds(next);
    setConfirmBulk(false);
  };
  const frameIndexAt = (clientX: number, clientY: number): number | null => {
    const el = document
      .elementFromPoint?.(clientX, clientY)
      ?.closest<HTMLElement>('[data-frame-index]');
    if (!el || !stripRef.current?.contains(el)) return null;
    const i = Number(el.dataset.frameIndex);
    return Number.isInteger(i) ? i : null;
  };
  const handleCellPointerDown = (e: React.PointerEvent, i: number) => {
    if (!selectMode || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const set = new Set(selected);
    if (e.shiftKey && lastAnchor !== null) {
      paintRange(lastAnchor, i, true, set);
      return;
    }
    const add = !set.has(frames[i]);
    dragRef.current = { anchor: i, add, base: set };
    setLastAnchor(i);
    paintRange(i, i, add, set);
    stripRef.current?.setPointerCapture?.(e.pointerId);
  };
  const handleStripPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag || !strip) return;
    // Near an edge: nudge the strip so a range can extend past what's visible.
    const r = strip.getBoundingClientRect();
    if (e.clientX < r.left + EDGE_SCROLL_PX) strip.scrollLeft -= EDGE_SCROLL_STEP;
    else if (e.clientX > r.right - EDGE_SCROLL_PX) strip.scrollLeft += EDGE_SCROLL_STEP;
    const i = frameIndexAt(e.clientX, e.clientY);
    if (i !== null) paintRange(drag.anchor, i, drag.add, drag.base);
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const allSelected = selected.length === n;
  const canBulkDelete = selected.length > 0 && selected.length < n;
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);
  // Exports the drawing as it is on screen — no gallery save needed first.
  const handleExport = async (kind: AnimationExportKind) => {
    setExportAnchor(null);
    setExporting(true);
    try {
      await exportLiveAnimation(
        {
          strokes: strokeManager.getStrokes(),
          layers: strokeManager.getLayers(),
          frames: strokeManager.getFrames(),
          fps: strokeManager.getFps(),
        },
        kind,
      );
    } catch (err) {
      console.error('Failed to export animation', err);
      alert(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // Per-frame thumbnail data + one shared world box so motion reads correctly
  // across cells. Recomputed only when the drawing changes.
  const thumbs = useMemo(() => {
    void contentVersion;
    return computeFrameThumbs(strokeManager);
  }, [strokeManager, contentVersion]);

  // Keep the shown frame scrolled into view (selection, playback).
  useEffect(() => {
    const strip = stripRef.current;
    const cell = strip?.querySelector<HTMLElement>(`[data-frame-index="${displayIndex}"]`);
    if (!strip || !cell) return;
    const l = cell.offsetLeft;
    const r = l + cell.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollLeft = l - 4;
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 4;
  }, [displayIndex, n]);

  const select = (index: number, transient?: boolean) => {
    const id = frames[Math.max(0, Math.min(n - 1, index))];
    if (id) onSelectFrame(id, transient ? { transient } : undefined);
  };

  const iconBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
    color?: string,
  ) => (
    <ToolbarTooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          sx={color && !disabled ? { color } : undefined}
        >
          {icon}
        </IconButton>
      </span>
    </ToolbarTooltip>
  );

  return (
    <Box
      sx={{
        borderTop: '1px solid #ddd',
        bgcolor: '#fafafa',
        px: 1,
        pt: 0.5,
        pb: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      {/* Row 1: transport + scrub + playback settings */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {iconBtn(
          t('framePrev'),
          <ChevronLeft size={18} />,
          () => select(displayIndex - 1),
          displayIndex <= 0,
        )}
        {iconBtn(
          playing ? t('animationPause') : t('animationPlay'),
          playing ? <Pause size={18} /> : <Play size={18} />,
          onTogglePlay,
          n <= 1,
          'primary.main',
        )}
        {iconBtn(
          t('frameNext'),
          <ChevronRight size={18} />,
          () => select(displayIndex + 1),
          displayIndex >= n - 1,
        )}
        <Slider
          size="small"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={displayIndex}
          disabled={n <= 1}
          aria-label={t('frameScrub')}
          onChange={(_e, v) => select(v as number, true)}
          onChangeCommitted={(_e, v) => select(v as number)}
          sx={{ flex: 1, mx: 1.5, minWidth: 60 }}
        />
        <Typography
          variant="caption"
          sx={{
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            minWidth: 44,
            textAlign: 'center',
          }}
        >
          {displayIndex + 1} / {n}
        </Typography>
        <Select
          size="small"
          variant="standard"
          value={strokeManager.getFps()}
          onChange={(e) => {
            if (strokeManager.setFps(Number(e.target.value))) onChanged();
          }}
          inputProps={{ 'aria-label': t('animationFps') }}
          sx={{ fontSize: 12, mx: 0.5 }}
        >
          {FPS_OPTIONS.map((f) => (
            <MenuItem key={f} value={f} sx={{ fontSize: 13 }}>
              {f} fps
            </MenuItem>
          ))}
        </Select>
        <ToolbarTooltip title={t('onionSkin')}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={onionRange}
            onChange={(_e, v: number | null) => {
              if (v !== null) onOnionRangeChange(v);
            }}
            aria-label={t('onionSkin')}
            sx={{
              '& .MuiToggleButton-root': {
                px: 0.75,
                py: 0.25,
                fontSize: 11,
                textTransform: 'none',
              },
            }}
          >
            <ToggleButton value={0} aria-label={t('onionOff')}>
              {t('onionOffShort')}
            </ToggleButton>
            <ToggleButton value={1} aria-label={`${t('onionSkin')} ±1`}>
              ±1
            </ToggleButton>
            <ToggleButton value={2} aria-label={`${t('onionSkin')} ±2`}>
              ±2
            </ToggleButton>
          </ToggleButtonGroup>
        </ToolbarTooltip>
      </Box>

      {/* Row 2: filmstrip + frame operations */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Box
          ref={stripRef}
          role="group"
          aria-label={t('frames')}
          onPointerMove={handleStripPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            gap: 0.5,
            overflowX: 'auto',
            py: 0.25,
            // Select mode: a drag paints a range instead of scrolling the strip
            // (edge auto-scroll + the scrub slider still reach far frames).
            touchAction: selectMode ? 'none' : undefined,
            userSelect: selectMode ? 'none' : undefined,
          }}
        >
          {thumbs.perFrame.map((f, i) => {
            const shown = i === displayIndex;
            const editing = f.frameId === currentId;
            const isSelected = selectMode && selectedIds.has(f.frameId);
            return (
              <Box
                key={f.frameId}
                component="button"
                type="button"
                data-frame-index={i}
                aria-pressed={selectMode ? isSelected : editing}
                aria-label={`${t('frame')} ${i + 1}`}
                onPointerDown={(e: React.PointerEvent) => handleCellPointerDown(e, i)}
                onClick={(e: React.MouseEvent) => {
                  if (!selectMode) {
                    select(i);
                  } else if (e.detail === 0) {
                    // Keyboard activation (no pointer events): toggle.
                    const set = new Set(selected);
                    paintRange(i, i, !set.has(f.frameId), set);
                  }
                }}
                sx={{
                  flexShrink: 0,
                  position: 'relative',
                  p: 0,
                  border: '2px solid',
                  borderColor: selectMode
                    ? isSelected
                      ? 'error.main'
                      : '#ccc'
                    : shown
                      ? 'primary.main'
                      : '#ccc',
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  bgcolor: 'white',
                }}
              >
                <FrameThumb strokes={f.strokes} colors={f.colors} box={thumbs.box} />
                {isSelected && (
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: 'rgba(211, 47, 47, 0.12)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'flex-end',
                      color: 'error.main',
                      p: '2px',
                      pointerEvents: 'none',
                    }}
                  >
                    <CircleCheck size={14} />
                  </Box>
                )}
                <Box
                  component="span"
                  sx={{
                    position: 'absolute',
                    left: 2,
                    top: 1,
                    fontSize: 10,
                    lineHeight: 1.2,
                    color: shown ? 'primary.main' : 'text.secondary',
                    fontWeight: shown ? 700 : 400,
                  }}
                >
                  {i + 1}
                </Box>
              </Box>
            );
          })}
          {/* "+" sits right after the last frame (where the next frame will
              appear) rather than with the far-away frame operations. */}
          <ToolbarTooltip title={t('frameAdd')}>
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <Box
                component="button"
                type="button"
                aria-label={t('frameAdd')}
                disabled={playing || selectMode || n >= MAX_FRAMES}
                onClick={() => {
                  if (strokeManager.addFrame({ atEnd: true })) onChanged();
                }}
                sx={{
                  width: THUMB_W + 4,
                  height: THUMB_H + 4,
                  p: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px dashed #bbb',
                  borderRadius: 1,
                  bgcolor: 'transparent',
                  color: 'text.secondary',
                  cursor: 'pointer',
                  '&:hover:not(:disabled)': { borderColor: 'primary.main', color: 'primary.main' },
                  '&:disabled': { opacity: 0.4, cursor: 'default' },
                }}
              >
                <Plus size={20} />
              </Box>
            </span>
          </ToolbarTooltip>
        </Box>
        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.25 }} />
        {selectMode ? (
          confirmBulk ? (
            <>
              <Typography variant="caption">{t('framesDeleteConfirm')}</Typography>
              {iconBtn(
                t('framesDelete'),
                <Check size={18} />,
                () => {
                  if (strokeManager.deleteFrames(selected)) onChanged();
                  exitSelectMode();
                },
                !canBulkDelete,
                'error.main',
              )}
              {iconBtn(t('cancel'), <X size={18} />, () => setConfirmBulk(false))}
            </>
          ) : (
            <>
              <Typography
                variant="caption"
                sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
              >
                {`${selected.length} ${t('framesSelected')}`}
              </Typography>
              {iconBtn(
                allSelected ? t('frameSelectNone') : t('frameSelectAll'),
                <CheckCheck size={18} />,
                () => {
                  setSelectedIds(allSelected ? new Set() : new Set(frames));
                  setConfirmBulk(false);
                },
                false,
                allSelected ? 'primary.main' : undefined,
              )}
              {iconBtn(
                allSelected ? t('framesDeleteKeepOne') : t('framesDelete'),
                <Trash2 size={18} />,
                () => setConfirmBulk(true),
                !canBulkDelete,
                'error.main',
              )}
              {iconBtn(t('frameSelectDone'), <X size={18} />, exitSelectMode)}
            </>
          )
        ) : pendingDelete ? (
          <>
            <Typography variant="caption">{t('frameDeleteConfirm')}</Typography>
            {iconBtn(
              t('frameDelete'),
              <Check size={18} />,
              () => {
                strokeManager.deleteFrame(currentId);
                setConfirmDeleteId(null);
                onChanged();
              },
              playing,
              'error.main',
            )}
            {iconBtn(t('cancel'), <X size={18} />, () => setConfirmDeleteId(null))}
          </>
        ) : (
          <>
            {iconBtn(
              t('frameDuplicate'),
              <Copy size={18} />,
              () => {
                if (strokeManager.addFrame({ duplicate: true })) onChanged();
              },
              playing || n >= MAX_FRAMES,
            )}
            {iconBtn(
              t('frameMoveEarlier'),
              <ArrowLeft size={18} />,
              () => {
                if (strokeManager.moveFrame(currentId, -1)) onChanged();
              },
              playing || currentIndex <= 0,
            )}
            {iconBtn(
              t('frameMoveLater'),
              <ArrowRight size={18} />,
              () => {
                if (strokeManager.moveFrame(currentId, 1)) onChanged();
              },
              playing || currentIndex >= n - 1,
            )}
            {iconBtn(
              t('frameSelectMode'),
              <ListChecks size={18} />,
              () => {
                setConfirmDeleteId(null);
                setSelectMode(true);
              },
              playing || n <= 1,
            )}
            {iconBtn(
              t('frameDelete'),
              <Trash2 size={18} />,
              () => {
                // Empty frames go without asking; undo covers both anyway.
                if (strokeManager.getFrameStrokeCount(currentId) === 0) {
                  if (strokeManager.deleteFrame(currentId)) onChanged();
                } else {
                  setConfirmDeleteId(currentId);
                }
              },
              playing || n <= 1,
              'error.main',
            )}
          </>
        )}
        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.25 }} />
        {videoSync && (
          <>
            {iconBtn(
              videoSync.active ? t('videoSyncOff') : t('videoSyncOn'),
              <Clapperboard size={18} />,
              videoSync.onToggle,
              videoSync.canEnable === false,
              videoSync.active ? 'primary.main' : undefined,
            )}
            {videoSync.active && videoSync.time !== null && (
              <Typography
                variant="caption"
                color="primary"
                sx={{ fontVariantNumeric: 'tabular-nums', mr: 0.5 }}
                aria-label={t('videoSyncTime')}
              >
                {formatVideoTime(videoSync.time)}
              </Typography>
            )}
          </>
        )}
        <ToolbarTooltip title={exporting ? t('exporting') : t('animationExport')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('animationExport')}
              aria-haspopup="menu"
              onClick={(e) => setExportAnchor(e.currentTarget)}
              disabled={exporting || strokeManager.getStrokes().length === 0}
            >
              {exporting ? <CircularProgress size={16} /> : <Download size={18} />}
            </IconButton>
          </span>
        </ToolbarTooltip>
        <Menu
          anchorEl={exportAnchor}
          open={Boolean(exportAnchor)}
          onClose={() => setExportAnchor(null)}
        >
          <MenuItem onClick={() => handleExport('gif')}>{t('exportGif')}</MenuItem>
          <MenuItem onClick={() => handleExport('sheet')}>{t('exportContactSheet')}</MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
