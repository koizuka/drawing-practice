import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { IconButton } from '@mui/material';
import { Eye, EyeOff } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { useLongPress } from '../hooks/useLongPress';
import { t } from '../i18n';

/** Hold duration that turns a press into a peek (short: peeking is a glance). */
export const MASK_PEEK_HOLD_MS = 300;

interface MaskRevealButtonProps {
  /** Persisted hidden state (GuideState.masksHidden). */
  masksHidden: boolean;
  /** True while a hold-to-peek is in progress (non-persisted). */
  peeking?: boolean;
  /** Quick tap: flip the persisted hidden state. */
  onToggle: () => void;
  /** Hold started: reveal temporarily. */
  onPeekStart: () => void;
  /** Hold released / cancelled / button unmounted: hide again. */
  onPeekEnd: () => void;
  disabled?: boolean;
}

/**
 * Reveal/hide toggle for reference masks with hold-to-peek:
 * - quick tap → `onToggle` (persisted reveal/hide, Phase 1 behaviour)
 * - hold ≥ MASK_PEEK_HOLD_MS → `onPeekStart`; release/cancel → `onPeekEnd`
 *   (`useLongPress` also ends the peek on unmount so it can't get stuck).
 *
 * Shows `EyeOff` (the "answer is showing" icon, highlighted) while revealed
 * OR peeking.
 */
export function MaskRevealButton({
  masksHidden,
  peeking = false,
  onToggle,
  onPeekStart,
  onPeekEnd,
  disabled = false,
}: MaskRevealButtonProps) {
  const longPress = useLongPress({
    onLongPress: onPeekStart,
    onClick: onToggle,
    onLongPressEnd: onPeekEnd,
    ms: MASK_PEEK_HOLD_MS,
  });
  const { onPointerDown } = longPress;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Capture so a mouse release off the button still reaches onPointerUp
      // and ends the peek (touch pointers are implicitly captured already).
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic / already-released pointers can throw; capture is best-effort.
      }
      onPointerDown(e);
    },
    [onPointerDown],
  );

  const shownRevealed = !masksHidden || peeking;
  return (
    <ToolbarTooltip title={masksHidden ? t('revealMasks') : t('hideMasks')}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          aria-label={masksHidden ? t('revealMasks') : t('hideMasks')}
          aria-pressed={shownRevealed}
          onPointerDown={handlePointerDown}
          onPointerMove={longPress.onPointerMove}
          onPointerUp={longPress.onPointerUp}
          onPointerCancel={longPress.onPointerCancel}
          onContextMenu={longPress.onContextMenu}
          // Pointer-driven clicks are handled by useLongPress; only a
          // keyboard-generated click (detail === 0) toggles here, keeping the
          // button operable with Enter/Space.
          onClick={(e) => {
            if (e.detail === 0) onToggle();
          }}
          sx={{
            color: shownRevealed ? 'primary.main' : 'inherit',
            // Hold gesture: no text selection / iOS callout / scroll takeover.
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {shownRevealed ? <EyeOff size={20} /> : <Eye size={20} />}
        </IconButton>
      </span>
    </ToolbarTooltip>
  );
}
