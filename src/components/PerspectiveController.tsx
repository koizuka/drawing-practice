import { useRef, useState, useCallback, useEffect } from 'react';
import { Box, IconButton, Paper, Slider } from '@mui/material';
import { Crosshair, Minimize2, RotateCcw } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import { useGuides } from '../guides/useGuides';
import { DEFAULT_PERSPECTIVE } from '../guides/types';
import { GridIcon } from './GridModePopoverButton';

const PAD_SIZE = 96;
const DOT_RADIUS = 6;

/**
 * Floating controls for the perspective grid, overlaid on the drawing canvas
 * (screen-fixed — deliberately not following camera pan/zoom). A square pad
 * maps its x/y to yaw/pitch (center = 0°, edges = ±90°), a vertical slider
 * sets the perspective strength, and a crosshair toggle arms the
 * place-anchor tap mode. Mounted only while grid.mode === 'perspective'.
 */
export function PerspectiveController() {
  const { grid, setPerspective, placingCenter, setPlacingCenter } = useGuides();
  const [collapsed, setCollapsed] = useState(false);
  const perspective = grid.perspective ?? DEFAULT_PERSPECTIVE;

  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Latest pad-drag value, flushed once per animation frame so a 120Hz pencil
  // doesn't trigger a state update (and both-panel redraw) per input event.
  const pendingRef = useRef<{ yaw: number; pitch: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const flushPending = useCallback((transient: boolean) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    if (!transient) pendingRef.current = null;
    setPerspective(pending, { transient });
  }, [setPerspective]);

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const u = Math.min(1, Math.max(-1, ((clientX - rect.left) / rect.width) * 2 - 1));
    const v = Math.min(1, Math.max(-1, ((clientY - rect.top) / rect.height) * 2 - 1));
    // Trackball-style: dragging the dot down tilts the box top toward the
    // viewer (positive pitch = looking down onto the floor).
    pendingRef.current = { yaw: u * 90, pitch: v * 90 };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingRef.current && draggingRef.current) flushPending(true);
      });
    }
  }, [flushPending]);

  const handlePadPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    updateFromPointer(e.clientX, e.clientY);
  }, [updateFromPointer]);

  const handlePadPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  }, [updateFromPointer]);

  const handlePadPointerEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // Commit the final value non-transiently so autosave flushes once per gesture.
    flushPending(false);
  }, [flushPending]);

  if (collapsed) {
    return (
      <Box sx={{ position: 'absolute', left: 8, bottom: 8, zIndex: 5 }}>
        <ToolbarTooltip title={t('expandPerspectiveController')}>
          <IconButton
            size="small"
            onClick={() => setCollapsed(false)}
            sx={{
              'bgcolor': 'info.main',
              'color': 'white',
              'boxShadow': 2,
              '&:hover': { bgcolor: 'info.dark' },
            }}
          >
            <GridIcon mode="perspective" />
          </IconButton>
        </ToolbarTooltip>
      </Box>
    );
  }

  const dotX = (perspective.yaw / 90) * (PAD_SIZE / 2 - DOT_RADIUS) + PAD_SIZE / 2;
  const dotY = (perspective.pitch / 90) * (PAD_SIZE / 2 - DOT_RADIUS) + PAD_SIZE / 2;

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        left: 8,
        bottom: 8,
        zIndex: 5,
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        // Never let pad/slider gestures fall through to the drawing canvas
        // or trigger browser scroll/zoom.
        touchAction: 'none',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          ref={padRef}
          aria-label={t('perspectiveRotation')}
          onPointerDown={handlePadPointerDown}
          onPointerMove={handlePadPointerMove}
          onPointerUp={handlePadPointerEnd}
          onPointerCancel={handlePadPointerEnd}
          sx={{
            position: 'relative',
            width: PAD_SIZE,
            height: PAD_SIZE,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            cursor: 'pointer',
            touchAction: 'none',
          }}
        >
          {/* Center cross marking the neutral (yaw=0, pitch=0) position */}
          <Box sx={{ position: 'absolute', left: '50%', top: 4, bottom: 4, width: '1px', bgcolor: 'divider' }} />
          <Box sx={{ position: 'absolute', top: '50%', left: 4, right: 4, height: '1px', bgcolor: 'divider' }} />
          <Box
            data-testid="perspective-pad-dot"
            sx={{
              position: 'absolute',
              left: dotX - DOT_RADIUS,
              top: dotY - DOT_RADIUS,
              width: DOT_RADIUS * 2,
              height: DOT_RADIUS * 2,
              borderRadius: '50%',
              bgcolor: 'info.main',
              pointerEvents: 'none',
            }}
          />
        </Box>
        <Slider
          orientation="vertical"
          aria-label={t('perspectiveStrength')}
          size="small"
          min={0}
          max={1}
          step={0.01}
          value={perspective.strength}
          onChange={(_e, value) => setPerspective({ strength: value as number }, { transient: true })}
          onChangeCommitted={(_e, value) => setPerspective({ strength: value as number })}
          sx={{ height: PAD_SIZE, touchAction: 'none' }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <ToolbarTooltip title={t('perspectivePlaceCenter')}>
          <IconButton
            size="small"
            onClick={() => setPlacingCenter(!placingCenter)}
            sx={{
              'bgcolor': placingCenter ? 'primary.main' : 'transparent',
              'color': placingCenter ? 'white' : 'inherit',
              '&:hover': { bgcolor: placingCenter ? 'primary.dark' : 'action.hover' },
            }}
          >
            <Crosshair size={18} />
          </IconButton>
        </ToolbarTooltip>
        <ToolbarTooltip title={t('perspectiveReset')}>
          <IconButton size="small" onClick={() => setPerspective({ ...DEFAULT_PERSPECTIVE })}>
            <RotateCcw size={18} />
          </IconButton>
        </ToolbarTooltip>
        <ToolbarTooltip title={t('collapsePerspectiveController')}>
          <IconButton size="small" onClick={() => setCollapsed(true)}>
            <Minimize2 size={18} />
          </IconButton>
        </ToolbarTooltip>
      </Box>
    </Paper>
  );
}
