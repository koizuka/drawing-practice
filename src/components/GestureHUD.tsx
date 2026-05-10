import { Box, IconButton, LinearProgress, Typography } from '@mui/material';
import { Pause, Play, SkipForward, X } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';

export interface GestureHUDProps {
  /** Hides the HUD entirely when false. */
  active: boolean;
  paused: boolean;
  loadingMore: boolean;
  durationMs: number;
  remainingMs: number;
  /** Number of poses completed via timeup. */
  completedCount: number;
  /** 1-based index of the current pose (= totalShownCount). */
  currentIndex: number;
  /** Photos still in the local queue (not counting the current one). */
  queueRemaining: number;
  /** True when more pages are still fetchable from the backend. Adds a "+"
   *  hint after the queued count. */
  hasMoreInBackend: boolean;
  /** Top offset (px) inside the positioned ancestor. Default 8; pass a
   *  larger value to clear a fixed toolbar above. */
  topOffset?: number;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  onExit: () => void;
}

function formatRemaining(ms: number): string {
  // Show whole seconds, rounding UP so the user sees "30" the moment a 30s
  // pose starts (otherwise the rounded-down value would already read 29).
  const seconds = Math.ceil(ms / 1000);
  return String(seconds);
}

/**
 * Heads-up display overlaid on the drawing panel during a gesture session:
 * countdown bar + skip / pause / exit buttons + "pose N (M queued)" status.
 *
 * The HUD is positioned absolute so it floats over the drawing canvas. Pointer
 * events are scoped to the actual controls so the rest of the canvas remains
 * drawable around it.
 */
export function GestureHUD({
  active,
  paused,
  loadingMore,
  durationMs,
  remainingMs,
  completedCount,
  currentIndex,
  queueRemaining,
  hasMoreInBackend,
  topOffset = 8,
  onSkip,
  onPause,
  onResume,
  onExit,
}: GestureHUDProps) {
  if (!active) return null;

  const progressPct = durationMs > 0
    ? Math.max(0, Math.min(100, (remainingMs / durationMs) * 100))
    : 0;

  const queuedHint = hasMoreInBackend ? `${queueRemaining}+` : `${queueRemaining}`;

  return (
    <Box
      data-testid="gesture-hud"
      sx={{
        position: 'absolute',
        top: topOffset,
        left: 8,
        right: 8,
        // Don't intercept pointer events on the empty area between controls —
        // children re-enable auto where needed.
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        zIndex: 10,
      }}
    >
      <Box
        sx={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'rgba(255,255,255,0.92)',
          borderRadius: 1,
          px: 1,
          py: 0.5,
          boxShadow: 1,
        }}
      >
        <Typography
          variant="h6"
          sx={{
            fontFamily: 'monospace',
            fontWeight: 700,
            minWidth: 36,
            textAlign: 'right',
            color: remainingMs <= 5000 ? 'error.main' : 'text.primary',
          }}
        >
          {formatRemaining(remainingMs)}
        </Typography>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LinearProgress
            variant="determinate"
            value={progressPct}
            sx={{
              'height': 8,
              'borderRadius': 4,
              '& .MuiLinearProgress-bar': {
                bgcolor: remainingMs <= 5000 ? 'error.main' : 'primary.main',
              },
            }}
          />
          <Typography
            variant="caption"
            sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.2, mt: 0.25 }}
          >
            {t('gestureSessionPosesLabel')}
            {' '}
            {currentIndex}
            {' '}
            (
            {completedCount}
            {' '}
            ✓)
            {' · '}
            {t('gestureSessionRemainingLabel')}
            {' '}
            {queuedHint}
            {loadingMore && ` · ${t('gestureSessionLoadingMore')}`}
          </Typography>
        </Box>

        <ToolbarTooltip title={paused ? t('gestureSessionResume') : t('gestureSessionPause')}>
          <IconButton
            size="small"
            onClick={paused ? onResume : onPause}
            aria-label={paused ? t('gestureSessionResume') : t('gestureSessionPause')}
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </IconButton>
        </ToolbarTooltip>

        <ToolbarTooltip title={t('gestureSessionSkip')}>
          <IconButton size="small" onClick={onSkip} aria-label={t('gestureSessionSkip')}>
            <SkipForward size={18} />
          </IconButton>
        </ToolbarTooltip>

        <ToolbarTooltip title={t('gestureSessionExit')}>
          <IconButton
            size="small"
            onClick={onExit}
            aria-label={t('gestureSessionExit')}
            sx={{ color: 'error.main' }}
          >
            <X size={18} />
          </IconButton>
        </ToolbarTooltip>
      </Box>
    </Box>
  );
}
