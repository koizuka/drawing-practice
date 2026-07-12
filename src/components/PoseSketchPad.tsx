import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Box, IconButton } from '@mui/material';
import { Trash2, Undo2 } from 'lucide-react';
import { StrokeManager } from '../drawing/StrokeManager';
import { CanvasRenderer } from '../drawing/CanvasRenderer';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';

/** Logical (and export) resolution of the sketch, independent of display size. */
export const SKETCH_SIZE = 512;

/** Stroke width in logical px — thick enough to read as a stick figure at 512². */
const SKETCH_STROKE_WIDTH = 8;

export interface PoseSketchPadHandle {
  /** PNG base64 WITHOUT the data-URL prefix; null when the sketch is empty. */
  exportPng: () => string | null;
  isEmpty: () => boolean;
}

interface PoseSketchPadProps {
  ref?: Ref<PoseSketchPadHandle>;
  /** Display edge length in CSS px (the pad is square). */
  displaySize: number;
}

/**
 * Minimal square sketch pad for drawing a stick figure. Owns a private
 * StrokeManager (unrelated to the drawing panel's shared instance and its
 * undo stack) and draws in a fixed 512×512 logical space — no ViewTransform,
 * no zoom/pan.
 */
export function PoseSketchPad({ ref, displaySize }: PoseSketchPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokeManager] = useState(() => new StrokeManager());
  const drawingRef = useRef(false);
  // Bumped on every stroke mutation so the undo/clear buttons re-render.
  const [, setStrokeVersion] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scale = canvas.width / SKETCH_SIZE;
    const renderer = new CanvasRenderer(ctx, { strokeWidth: SKETCH_STROKE_WIDTH });
    renderer.clear();
    ctx.scale(scale, scale);
    renderer.drawStrokes(strokeManager.getStrokes());
    const current = strokeManager.getCurrentStroke();
    if (current) renderer.drawStroke(current);
  }, [strokeManager]);

  // Size the backing store for the display size × DPR; logical space stays 512².
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displaySize * dpr);
    canvas.height = Math.round(displaySize * dpr);
    redraw();
  }, [displaySize, redraw]);

  const toLogicalPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SKETCH_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SKETCH_SIZE,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current) return;
    drawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    catch { /* synthetic events / older browsers — capture is best-effort */ }
    strokeManager.startStroke(toLogicalPoint(e));
    redraw();
  }, [strokeManager, toLogicalPoint, redraw]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    if (strokeManager.appendStroke(toLogicalPoint(e))) redraw();
  }, [strokeManager, toLogicalPoint, redraw]);

  const endStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    strokeManager.endStroke();
    setStrokeVersion(v => v + 1);
    redraw();
  }, [strokeManager, redraw]);

  const handleUndo = useCallback(() => {
    strokeManager.undo();
    setStrokeVersion(v => v + 1);
    redraw();
  }, [strokeManager, redraw]);

  const handleClear = useCallback(() => {
    strokeManager.clear();
    setStrokeVersion(v => v + 1);
    redraw();
  }, [strokeManager, redraw]);

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      if (strokeManager.getStrokes().length === 0) return null;
      // Export from a fresh offscreen canvas at logical resolution so the
      // output is DPR-independent (same pattern as generateThumbnail).
      const offscreen = document.createElement('canvas');
      offscreen.width = SKETCH_SIZE;
      offscreen.height = SKETCH_SIZE;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return null;
      const renderer = new CanvasRenderer(ctx, { strokeWidth: SKETCH_STROKE_WIDTH });
      renderer.clear();
      renderer.drawStrokes(strokeManager.getStrokes());
      const dataUrl = offscreen.toDataURL('image/png');
      const comma = dataUrl.indexOf(',');
      return comma >= 0 ? dataUrl.slice(comma + 1) : null;
    },
    isEmpty: () => strokeManager.getStrokes().length === 0,
  }), [strokeManager]);

  const hasStrokes = strokeManager.getStrokes().length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        style={{
          width: displaySize,
          height: displaySize,
          border: '1px solid #ccc',
          borderRadius: 4,
          touchAction: 'none',
          backgroundColor: '#fff',
        }}
      />
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <ToolbarTooltip title={t('poseSketchUndo')}>
          <span>
            <IconButton size="small" onClick={handleUndo} disabled={!strokeManager.canUndo()}>
              <Undo2 size={18} />
            </IconButton>
          </span>
        </ToolbarTooltip>
        <ToolbarTooltip title={t('poseSketchClear')}>
          <span>
            <IconButton size="small" onClick={handleClear} disabled={!hasStrokes} sx={{ color: 'error.main' }}>
              <Trash2 size={18} />
            </IconButton>
          </span>
        </ToolbarTooltip>
      </Box>
    </Box>
  );
}
