import { useEffect, useState, type RefObject } from 'react';
import { Box, Typography } from '@mui/material';
import { Pause } from 'lucide-react';
import { t } from '../i18n';
import { evaluateFreezeHint, isFreezeHintEligible, EST_HALF_W, type FreezeHintResult } from './freezeHintLogic';

const POLL_MS = 300;
const HIDDEN: FreezeHintResult = { visible: false, x: 0, y: 0 };

/**
 * Production mitigation for the confirmed Apple Pencil input-freeze bug
 * (see docs/apple-pencil-input-freeze.md). WebKit/iPadOS sometimes stops
 * delivering ALL touch/pointer events page-wide after a long sustained
 * drawing run; the page itself keeps running at 60fps and recovers when the
 * user lifts the pen for ~2s. The user can't tell input died (they keep
 * scribbling, which prolongs it), so we detect the silence in-page and show a
 * non-blocking "lift your pen" hint NEAR where they were drawing (that's where
 * their eyes are while concentrating). It auto-dismisses when input resumes.
 *
 * Why a DOM overlay polled by setInterval (not canvas drawing): redraw is
 * input-driven and never runs during the freeze, but the main thread / timers
 * are alive, so a timer-driven React element paints fine.
 *
 * False positives: an intentional rest and a real freeze BOTH look like "no
 * events" to the page — they're indistinguishable. We minimize the harm rather
 * than eliminate it: (1) only after a long continuous-draw streak (the
 * freeze-prone regime), (2) non-blocking + auto-hide on input resume,
 * (3) auto-hide after MAX_VISIBLE_MS so it never lingers after a session ends.
 *
 * Touch-only: the gating refs are fed by touch handlers, so desktop mouse use
 * never triggers it.
 */

interface DrawingFreezeHintProps {
  lastInputAtRef: RefObject<number>;
  streakStartAtRef: RefObject<number>;
  lastClientRef: RefObject<{ x: number; y: number } | null>;
  containerRef: RefObject<HTMLElement | null>;
}

export function DrawingFreezeHint({
  lastInputAtRef,
  streakStartAtRef,
  lastClientRef,
  containerRef,
}: DrawingFreezeHintProps) {
  const [hint, setHint] = useState<FreezeHintResult>({ visible: false, x: 0, y: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const lastInputAt = lastInputAtRef.current ?? 0;
      const streakStartAt = streakStartAtRef.current ?? 0;
      // Cheap time-only gate first: on the common ticks (recently drew, or no
      // long streak) we skip the getBoundingClientRect layout read entirely.
      let next = HIDDEN;
      if (isFreezeHintEligible(lastInputAt, streakStartAt, now)) {
        const rect = containerRef.current?.getBoundingClientRect() ?? null;
        next = evaluateFreezeHint({ lastInputAt, streakStartAt, client: lastClientRef.current, containerRect: rect }, now);
      }
      // Only re-render on an actual change (visibility flip or moved anchor).
      setHint(prev =>
        prev.visible === next.visible && prev.x === next.x && prev.y === next.y ? prev : next,
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [lastInputAtRef, streakStartAtRef, lastClientRef, containerRef]);

  if (!hint.visible) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        left: hint.x,
        top: hint.y,
        // Center the pill above the anchor so it sits over the last-drawn point.
        transform: 'translate(-50%, calc(-100% - 8px))',
        zIndex: 10,
        // Never intercept drawing / hit-testing.
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        // Keep the rendered half-width within the clamp reserve (EST_HALF_W) so
        // the on-screen pill matches the geometry the clamp assumes.
        maxWidth: EST_HALF_W * 2,
        bgcolor: 'rgba(0,0,0,0.78)',
        color: 'white',
        borderRadius: 1,
        px: 1.25,
        py: 0.75,
        boxShadow: 3,
      }}
    >
      <Pause size={18} style={{ flexShrink: 0 }} />
      <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.3 }}>
        {t('inputFrozenHint')}
      </Typography>
    </Box>
  );
}
