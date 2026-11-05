import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  IconButton,
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
  ChevronRight,
  Copy,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import type { StrokeManager } from '../drawing/StrokeManager';
import { FPS_OPTIONS, MAX_FRAMES } from '../drawing/frames';
import { orderStrokesForRender } from '../drawing/layers';
import { STROKE_WIDTH } from '../drawing/constants';
import type { Stroke } from '../drawing/types';

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
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const perFrame = strokeManager.getFrames().map((frameId) => {
    const items = orderStrokesForRender(strokes, layers, strokeManager.getFrameView(frameId));
    for (const it of items) {
      for (const p of it.stroke.points) {
        if (p.x < bb.minX) bb.minX = p.x;
        if (p.y < bb.minY) bb.minY = p.y;
        if (p.x > bb.maxX) bb.maxX = p.x;
        if (p.y > bb.maxY) bb.maxY = p.y;
      }
    }
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
}: AnimationTimelineProps) {
  const frames = strokeManager.getFrames();
  const currentId = strokeManager.getCurrentFrameId();
  const currentIndex = strokeManager.getCurrentFrameIndex();
  const n = frames.length;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pendingDelete = confirmDeleteId === currentId;
  const stripRef = useRef<HTMLDivElement>(null);

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
          sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5, overflowX: 'auto', py: 0.25 }}
        >
          {thumbs.perFrame.map((f, i) => {
            const shown = i === displayIndex;
            const editing = f.frameId === currentId;
            return (
              <Box
                key={f.frameId}
                component="button"
                type="button"
                data-frame-index={i}
                aria-pressed={editing}
                aria-label={`${t('frame')} ${i + 1}`}
                onClick={() => select(i)}
                sx={{
                  flexShrink: 0,
                  position: 'relative',
                  p: 0,
                  border: '2px solid',
                  borderColor: shown ? 'primary.main' : '#ccc',
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  bgcolor: 'white',
                }}
              >
                <FrameThumb strokes={f.strokes} colors={f.colors} box={thumbs.box} />
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
                disabled={playing || n >= MAX_FRAMES}
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
        {pendingDelete ? (
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
              false,
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
      </Box>
    </Box>
  );
}
