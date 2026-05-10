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
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  onExit: () => void;
}

function formatRemaining(ms: number): string {
  // Round UP so the first frame of a 30s pose reads "30", not "29".
  const seconds = Math.ceil(ms / 1000);
  return String(seconds);
}

/**
 * Horizontal row rendered above the SplitLayout panels during a gesture
 * session: countdown bar + skip / pause / exit buttons + "pose N (M queued)"
 * status. Sized as a normal flex row so it does not obscure the drawing
 * canvas — the canvas keeps the same height as the reference panel.
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
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: '#fafafa',
        borderBottom: '1px solid #ddd',
        px: 1,
        py: 0.5,
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
  );
}
