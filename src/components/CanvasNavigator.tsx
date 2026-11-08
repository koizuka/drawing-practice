import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { visibleStrokes } from '../drawing/layers';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { StrokeManager } from '../drawing/StrokeManager';
import type { ViewTransform } from '../drawing/ViewTransform';
import { computeBaseScale, emptyBoundingBox, extendBoundingBox } from '../drawing/canvasUtils';
import { makeWorldToScreen, navigatorScale, worldUpScreenAngle } from '../drawing/navigator';
import { displayRotationDegrees, isRightAngleRotation } from '../drawing/rotation';
import type { Point } from '../drawing/types';
import { t } from '../i18n';

/** Diameter of the overview disc (CSS px). */
const NAV_SIZE = 120;
/** Gap between the disc edge and the content area, room for the rim marker. */
const NAV_RIM = 10;
/** Size of the round buttons (▲, and the ⟲ / ⟳ step buttons). */
const COMPACT_SIZE = 36;
/** Gap between the round buttons in the top row. */
const BUTTON_GAP = 6;
/** How long the overview lingers after the last camera gesture. */
const ACTIVE_LINGER_MS = 2000;
/** Point budget for the overview's stroke thumbnail (subsampled above this). */
const STROKE_POINT_BUDGET = 3000;

/**
 * The world-up marker: a notched arrowhead (tip at y = -9, pointing up) in a
 * 20×20 box centered on the origin. Not a plain ▲ — a near-equilateral
 * triangle reads as ◀ / ▼ / ▶ at 30° / 60° / -30°, while the notch keeps the
 * tip unmistakable at every angle. Shared by the ▲ button and the disc's rim
 * marker so both read as the same thing.
 */
const UP_ARROW: readonly (readonly [number, number])[] = [
  [0, -9],
  [6.5, 7],
  [0, 3.5],
  [-6.5, 7],
];
const UP_ARROW_PATH = `M${UP_ARROW.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
/** Rim marker: the arrow scaled to this height, tip just inside the disc edge. */
const RIM_MARKER_HEIGHT = 10;

const UPRIGHT_COLOR = '#2e7d32';
const TILTED_COLOR = '#616161';
const VIEWPORT_COLOR = '#1976d2';

const pulse = keyframes`
  0% { transform: scale(1); }
  40% { transform: scale(1.25); }
  100% { transform: scale(1); }
`;

interface CanvasNavigatorProps {
  viewTransform: ViewTransform;
  strokeManager: StrokeManager;
  /** Reference content size in world units (centered on the origin); absent for free drawing. */
  fitSize?: { width: number; height: number };
  isFlipped: boolean;
  /** Bumped whenever the committed stroke set changes (DrawingPanel's redrawVersion). */
  contentVersion: number;
  /**
   * Animation frame to overview — the DISPLAYED frame (playback position while
   * playing), which can differ from the manager's current frame. Absent ⇒
   * the current frame.
   */
  frameId?: string;
  /** Rotate back upright (the ▲ tap). */
  onResetRotation: () => void;
  /**
   * Show ⟲ / ⟳ step buttons left of the ▲ (same as keys 4 / 6) — the only
   * way to rotate in steps without a keyboard. The ▲ then stays up too, so
   * the row doesn't jump as the view goes off / back to home.
   */
  showRotateButtons?: boolean;
  /** One rotation step in SCREEN direction (-1 = ⟲ / key 4, +1 = ⟳ / key 6). */
  onRotateStep?: (dir: 1 | -1) => void;
  /** Top offset (CSS px) so the widget clears other top-right overlays. */
  top?: number;
}

/** Round, pointer-active button used for the ▲ and the step buttons. */
function RoundButton({
  label,
  right,
  top,
  borderColor = 'rgba(0, 0, 0, 0.25)',
  onClick,
  children,
}: {
  label: string;
  right: number;
  top: number;
  borderColor?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      sx={{
        position: 'absolute',
        top,
        right,
        width: COMPACT_SIZE,
        height: COMPACT_SIZE,
        p: 0,
        border: '1px solid',
        borderColor,
        borderRadius: '50%',
        bgcolor: 'rgba(255, 255, 255, 0.92)',
        color: TILTED_COLOR,
        cursor: 'pointer',
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Drawing-panel navigator: a small ▲ button while the camera is off home
 * (tap = rotate back upright), plus an overview disc during and shortly
 * after camera gestures. Both are drawn in screen orientation — see
 * `src/drawing/navigator.ts`.
 *
 * The disc is pointer-transparent on purpose: it appears under the user's
 * hands mid-pinch, and catching a finger there would break the next pinch.
 * The ▲ button is the only tap target.
 *
 * Lives outside the drawing canvas's CSS-flipped wrapper so its marker and
 * labels never mirror; the flip is applied to the map geometry instead.
 */
export function CanvasNavigator({
  viewTransform,
  strokeManager,
  fitSize,
  isFlipped,
  contentVersion,
  frameId,
  onResetRotation,
  showRotateButtons = false,
  onRotateStep,
  top = 8,
}: CanvasNavigatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRotationRef = useRef(viewTransform.getRotation());

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setContainer((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribe = viewTransform.subscribe((intent) => {
      setTick((n) => n + 1);
      // Landing on a 90° position (snap, key step, reset) pulses the marker
      // so the "now upright" moment is noticeable. Continuous pinch angles
      // practically never hit an exact multiple, so this only fires on
      // discrete settles.
      const rotation = viewTransform.getRotation();
      if (!isRightAngleRotation(prevRotationRef.current) && isRightAngleRotation(rotation)) {
        setPulseKey((k) => k + 1);
      }
      prevRotationRef.current = rotation;
      if (intent === 'gesture' || intent === 'userRotate') {
        setActive(true);
        if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
        lingerTimerRef.current = setTimeout(() => {
          lingerTimerRef.current = null;
          setActive(false);
        }, ACTIVE_LINGER_MS);
      }
    });
    return () => {
      unsubscribe();
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    };
  }, [viewTransform]);

  // Stroke bbox + subsampling stride, recomputed only when strokes change.
  const strokeSummary = useMemo(() => {
    void contentVersion;
    const strokes = visibleStrokes(
      strokeManager.getStrokes(),
      strokeManager.getLayers(),
      strokeManager.getFrameView(frameId),
    );
    const bb = emptyBoundingBox();
    let total = 0;
    for (const s of strokes) {
      total += s.points.length;
      for (const p of s.points) extendBoundingBox(bb, p);
    }
    return {
      bbox: total > 0 ? bb : null,
      stride: Math.max(1, Math.ceil(total / STROKE_POINT_BUDGET)),
    };
  }, [strokeManager, contentVersion, frameId]);

  const ready = container.width > 0 && container.height > 0;
  const baseScale = computeBaseScale(container, fitSize);
  const upAngle = worldUpScreenAngle(
    viewTransform.projectMatrix(container, baseScale, true),
    isFlipped,
  );
  const degrees = displayRotationDegrees(viewTransform.getRotation(), isFlipped);
  // Upright is the EXACT state (only snaps / key steps / resets land on it),
  // not the rounded readout — a 0.3° tilt reads "0°" but must not go green.
  const upright = viewTransform.getRotation() === 0;
  const dirty = viewTransform.isDirty();
  const showDisc = ready && active;

  // Redraw only when something the map shows changed: camera (`tick`),
  // layout, strokes, reference size or flip. Without deps this ran after
  // every parent render (e.g. the timer's 1s tick) and re-walked all strokes.
  useEffect(() => {
    if (!showDisc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== NAV_SIZE * dpr) {
      canvas.width = NAV_SIZE * dpr;
      canvas.height = NAV_SIZE * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: W, height: H } = container;
    const matrix = viewTransform.projectMatrix(container, baseScale, true);
    const toScreen = makeWorldToScreen(matrix, W, isFlipped);
    const markerAngle = worldUpScreenAngle(matrix, isFlipped);
    const markerUpright = viewTransform.getRotation() === 0;

    const anchors: Point[] = [{ x: 0, y: 0 }];
    const { bbox, stride } = strokeSummary;
    if (bbox) {
      anchors.push(
        { x: bbox.minX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.minY },
        { x: bbox.minX, y: bbox.maxY },
        { x: bbox.maxX, y: bbox.maxY },
      );
    }
    const refCorners: Point[] | null =
      fitSize && fitSize.width > 0 && fitSize.height > 0
        ? [
            { x: -fitSize.width / 2, y: -fitSize.height / 2 },
            { x: fitSize.width / 2, y: -fitSize.height / 2 },
            { x: fitSize.width / 2, y: fitSize.height / 2 },
            { x: -fitSize.width / 2, y: fitSize.height / 2 },
          ]
        : null;
    if (refCorners) anchors.push(...refCorners);

    const half = NAV_SIZE / 2;
    const radius = half - NAV_RIM;
    const k = navigatorScale(container, anchors.map(toScreen), radius);
    const toNav = (w: Point) => {
      const p = toScreen(w);
      return { x: half + (p.x - W / 2) * k, y: half + (p.y - H / 2) * k };
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, NAV_SIZE, NAV_SIZE);

    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, radius + NAV_RIM / 2, 0, Math.PI * 2);
    ctx.clip();

    if (refCorners) {
      ctx.beginPath();
      refCorners
        .map(toNav)
        .forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = '#eceff1';
      ctx.fill();
      ctx.strokeStyle = '#b0bec5';
      ctx.stroke();
    }

    ctx.strokeStyle = '#424242';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of visibleStrokes(
      strokeManager.getStrokes(),
      strokeManager.getLayers(),
      strokeManager.getFrameView(frameId),
    )) {
      const pts = s.points;
      if (pts.length === 0) continue;
      const first = toNav(pts[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = stride; i < pts.length; i += stride) {
        const p = toNav(pts[i]);
        ctx.lineTo(p.x, p.y);
      }
      const last = toNav(pts[pts.length - 1]);
      ctx.lineTo(last.x + 0.01, last.y);
    }
    ctx.stroke();

    // Grid center (world origin) marker.
    const o = toNav({ x: 0, y: 0 });
    ctx.strokeStyle = '#90a4ae';
    ctx.beginPath();
    ctx.moveTo(o.x - 3, o.y);
    ctx.lineTo(o.x + 3, o.y);
    ctx.moveTo(o.x, o.y - 3);
    ctx.lineTo(o.x, o.y + 3);
    ctx.stroke();

    // Current screen: always an upright rectangle around the disc center.
    const vw = W * k;
    const vh = H * k;
    ctx.fillStyle = 'rgba(25, 118, 210, 0.08)';
    ctx.fillRect(half - vw / 2, half - vh / 2, vw, vh);
    ctx.strokeStyle = VIEWPORT_COLOR;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(half - vw / 2, half - vh / 2, vw, vh);
    ctx.restore();

    // Fixed 12 o'clock tick: the ▲ lines up with it when upright.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(half, 1);
    ctx.lineTo(half, 5);
    ctx.stroke();

    // World-up marker on the rim, pointing outward.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(markerAngle);
    ctx.beginPath();
    const arrowScale = RIM_MARKER_HEIGHT / 16;
    UP_ARROW.forEach(([x, y], i) => {
      const px = x * arrowScale;
      const py = -half + 2 + (y + 9) * arrowScale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = markerUpright ? UPRIGHT_COLOR : TILTED_COLOR;
    ctx.fill();
    ctx.restore();
  }, [
    showDisc,
    tick,
    container,
    baseScale,
    fitSize,
    isFlipped,
    viewTransform,
    strokeManager,
    strokeSummary,
    frameId,
  ]);

  const label = upright ? `✓ ${t('viewUpright')}` : `${degrees > 0 ? '+' : ''}${degrees}°`;

  return (
    <Box
      ref={rootRef}
      sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}
      data-testid="canvas-navigator"
    >
      {/* Also kept up while the disc lingers, so a reset that lands fully at
          home still shows the upright pulse before the ▲ goes away. */}
      {/* DOM order = visual order (⟲ ⟳ ▲) for focus / screen readers. */}
      {showRotateButtons && onRotateStep && (
        <>
          <RoundButton
            label={t('rotateViewLeft')}
            right={8 + 2 * (COMPACT_SIZE + BUTTON_GAP)}
            top={top}
            onClick={() => onRotateStep(-1)}
          >
            <RotateCcw size={18} aria-hidden />
          </RoundButton>
          <RoundButton
            label={t('rotateViewRight')}
            right={8 + COMPACT_SIZE + BUTTON_GAP}
            top={top}
            onClick={() => onRotateStep(1)}
          >
            <RotateCw size={18} aria-hidden />
          </RoundButton>
        </>
      )}
      {(dirty || showDisc || showRotateButtons) && (
        <RoundButton
          label={t('resetRotation')}
          right={8}
          top={top}
          borderColor={upright ? UPRIGHT_COLOR : undefined}
          // Already upright (the green ▲): nothing to do — skip the command so
          // a tap doesn't emit a no-op 'userRotate' (and its autosave flush).
          onClick={() => {
            if (!upright) onResetRotation();
          }}
        >
          <Box
            key={pulseKey}
            sx={{
              display: 'flex',
              animation: pulseKey > 0 ? `${pulse} 400ms ease-out` : undefined,
            }}
          >
            <svg
              width={20}
              height={20}
              viewBox="-10 -10 20 20"
              style={{ transform: `rotate(${upAngle}rad)`, display: 'block' }}
              aria-hidden
            >
              <path d={UP_ARROW_PATH} fill={upright ? UPRIGHT_COLOR : TILTED_COLOR} />
            </svg>
          </Box>
        </RoundButton>
      )}
      {showDisc && (
        <Box
          sx={{
            position: 'absolute',
            top: top + COMPACT_SIZE + BUTTON_GAP,
            right: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.25,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: NAV_SIZE, height: NAV_SIZE, display: 'block' }}
            data-testid="canvas-navigator-map"
          />
          <Typography
            variant="caption"
            sx={{
              px: 0.75,
              borderRadius: 1,
              bgcolor: 'rgba(255, 255, 255, 0.92)',
              color: upright ? UPRIGHT_COLOR : 'text.primary',
              fontWeight: upright ? 600 : 400,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {isFlipped ? ` · ⇋ ${t('viewFlipped')}` : ''}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
