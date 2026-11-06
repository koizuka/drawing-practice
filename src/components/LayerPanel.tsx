import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Paper,
  FormControlLabel,
  Slider,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eraser,
  Eye,
  EyeOff,
  Layers2,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { PANEL_CORNERS, type PanelCorner } from './layerPanelCorner';
import { t } from '../i18n';
import type { StrokeManager } from '../drawing/StrokeManager';
import { LAYER_COLOR_HEX, MAX_LAYERS, type Layer, type LayerColor } from '../drawing/layers';

/** Shown name: the user's name, else "Layer N" (N = 1-based position from the bottom). */
function layerDisplayName(layer: Layer, index: number): string {
  return layer.name.trim() !== '' ? layer.name : `${t('layer')} ${index + 1}`;
}

const COLOR_OPTIONS: {
  value: LayerColor;
  labelKey: 'layerColorInk' | 'layerColorBlue' | 'layerColorRed';
}[] = [
  { value: 'ink', labelKey: 'layerColorInk' },
  { value: 'blue', labelKey: 'layerColorBlue' },
  { value: 'red', labelKey: 'layerColorRed' },
];

interface LayerToolbarButtonProps {
  strokeManager: StrokeManager;
  /** Whether the docked layer panel is open (button shows pressed). */
  open: boolean;
  onToggle: () => void;
}

/**
 * Drawing-toolbar toggle for the docked `LayerPanel`. Shows the active layer
 * number as a badge when there is more than one layer, and turns warning-
 * colored when the active layer is hidden / locked (pen and eraser refused).
 */
export function LayerToolbarButton({ strokeManager, open, onToggle }: LayerToolbarButtonProps) {
  const layers = strokeManager.getLayers();
  const activeId = strokeManager.getActiveLayerId();
  const activeIndex = layers.findIndex((l) => l.id === activeId);
  const active = layers[activeIndex] ?? layers[0];
  const blocked = !strokeManager.canDrawOnActiveLayer();
  const multi = layers.length > 1;
  const tooltip = blocked
    ? t('layerBlocked')
    : multi
      ? `${t('layers')}: ${layerDisplayName(active, activeIndex)}`
      : t('layers');
  const color = blocked ? 'warning.main' : multi ? 'primary.main' : 'inherit';

  return (
    <ToolbarTooltip title={tooltip}>
      <IconButton
        size="small"
        aria-label={t('layers')}
        aria-pressed={open}
        onClick={onToggle}
        sx={{
          position: 'relative',
          bgcolor: open ? 'action.selected' : 'transparent',
          color,
        }}
      >
        <Layers2 size={20} />
        {multi && (
          <Box
            component="span"
            aria-hidden
            sx={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              minWidth: 14,
              height: 14,
              px: '2px',
              borderRadius: '7px',
              fontSize: 10,
              lineHeight: '14px',
              fontWeight: 700,
              bgcolor: blocked ? 'warning.main' : 'primary.main',
              color: 'white',
            }}
          >
            {activeIndex + 1}
          </Box>
        )}
      </IconButton>
    </ToolbarTooltip>
  );
}

const CORNER_LABEL_KEY: Record<
  PanelCorner,
  'layerPanelCornerTl' | 'layerPanelCornerTr' | 'layerPanelCornerBl' | 'layerPanelCornerBr'
> = {
  tl: 'layerPanelCornerTl',
  tr: 'layerPanelCornerTr',
  bl: 'layerPanelCornerBl',
  br: 'layerPanelCornerBr',
};

/** Absolute placement flush to `corner`; the rounded / bordered side faces inward. */
function cornerSx(corner: PanelCorner) {
  const top = corner[0] === 't';
  const left = corner[1] === 'l';
  const v = top ? 'Bottom' : 'Top';
  const h = left ? 'Right' : 'Left';
  return {
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    [`border${h}`]: '1px solid #ddd',
    [`border${v}`]: '1px solid #ddd',
    [`border${v}${h}Radius`]: 8,
  };
}

/**
 * 2×2 mini map of the canvas corners: tap a cell to dock the panel there. A
 * fixed set of four spots is all that's needed (no free dragging) — the point
 * is just to get the panel out of the area you're drawing in.
 */
function CornerPicker({
  corner,
  onChange,
}: {
  corner: PanelCorner;
  onChange: (c: PanelCorner) => void;
}) {
  return (
    <Box
      role="group"
      aria-label={t('layerPanelCorner')}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 14px)',
        gap: '2px',
        p: '3px',
        mr: 0.5,
        border: '1px solid #ccc',
        borderRadius: 0.5,
      }}
    >
      {PANEL_CORNERS.map((c) => {
        const selected = c === corner;
        return (
          <ToolbarTooltip key={c} title={t(CORNER_LABEL_KEY[c])}>
            <ButtonBase
              aria-label={t(CORNER_LABEL_KEY[c])}
              aria-pressed={selected}
              onClick={() => onChange(c)}
              sx={{
                width: 14,
                height: 10,
                borderRadius: '2px',
                bgcolor: selected ? 'primary.main' : '#e0e0e0',
                '&:hover': { bgcolor: selected ? 'primary.dark' : '#bdbdbd' },
              }}
            />
          </ToolbarTooltip>
        );
      })}
    </Box>
  );
}

interface LayerPanelProps {
  strokeManager: StrokeManager;
  /**
   * Called after every layer mutation. `flush: true` for discrete edits
   * (persist immediately); omitted for continuous ones (slider drag, typing)
   * which ride the 2s autosave debounce.
   */
  onChanged: (opts?: { flush?: boolean }) => void;
  /** Show animation-only layer settings (the "all frames" switch). */
  showFrameOptions?: boolean;
  onClose: () => void;
  /** Docked corner of the canvas area (default top-left). */
  corner?: PanelCorner;
  onCornerChange?: (corner: PanelCorner) => void;
  /**
   * Reports the panel's rendered height (CSS px) so widgets pinned to the
   * same corner (navigator / trace badge at top-right, perspective controller
   * at bottom-left) can step aside instead of being covered.
   */
  onHeightChange?: (height: number) => void;
}

/**
 * Layer manager (see docs/layers.md), docked flush to one corner (default
 * top-left; switchable via the header's corner picker) of
 * the drawing canvas area. Deliberately NOT a modal popover: picking a layer
 * and then drawing must work without closing anything first, and hugging the
 * edge keeps it clear of where you draw. Reads the layer list inline from the
 * StrokeManager on each render — the parent re-renders after `onChanged`,
 * same pattern as canUndo/canRedo.
 */
export function LayerPanel({
  strokeManager,
  onChanged,
  showFrameOptions = false,
  onClose,
  corner = 'tl',
  onCornerChange,
  onHeightChange,
}: LayerPanelProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  });
  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const report = () => onHeightChangeRef.current?.(el.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeightChangeRef.current?.(0);
    };
  }, []);
  // In-place destructive confirm (ui-design-principles §4): which action is
  // pending for the active layer. Reset whenever the active layer changes.
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'clear'; layerId: string } | null>(
    null,
  );

  const layers = strokeManager.getLayers();
  const activeId = strokeManager.getActiveLayerId();
  const activeIndex = layers.findIndex((l) => l.id === activeId);
  const active = layers[activeIndex] ?? layers[0];
  const blocked = !strokeManager.canDrawOnActiveLayer();
  const multi = layers.length > 1;
  const pendingConfirm = confirm && confirm.layerId === activeId ? confirm.kind : null;

  const change = (flush = true) => onChanged(flush ? { flush: true } : undefined);

  const handlePreset = () => {
    // "Draft → ink": the existing layer becomes a faint blue draft and a clean
    // ink layer is added on top. If the user has already drawn, they most
    // likely want to start inking now, so the new layer becomes active;
    // otherwise stay on the draft so the first lines are the rough.
    const base = layers[0];
    const hasStrokes = strokeManager.getStrokes().length > 0;
    strokeManager.updateLayer(base.id, { name: t('layerDraft'), color: 'blue', opacity: 0.5 });
    strokeManager.addLayer({ name: t('layerInk') });
    if (!hasStrokes) strokeManager.setActiveLayer(base.id);
    change();
  };

  return (
    <Paper
      ref={paperRef}
      elevation={4}
      role="region"
      aria-label={t('layers')}
      square
      sx={{
        position: 'absolute',
        zIndex: 6,
        width: 280,
        maxWidth: '100%',
        maxHeight: '100%',
        overflowY: 'auto',
        ...cornerSx(corner),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, pt: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t('layers')}
        </Typography>
        {onCornerChange && <CornerPicker corner={corner} onChange={onCornerChange} />}
        <IconButton size="small" aria-label={t('layerPanelClose')} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </Box>
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Layer list, top layer first (as in every paint app). Plain
            list + buttons (no listbox roles): each row is [eye][lock]
            [select button], so every control is natively focusable and
            Enter/Space-activatable without nesting buttons in an option. */}
        <Box component="ul" aria-label={t('layers')} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {layers
            .map((layer, index) => ({ layer, index }))
            .reverse()
            .map(({ layer, index }) => {
              const isActive = layer.id === activeId;
              return (
                <Box
                  component="li"
                  key={layer.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.5,
                    borderRadius: 1,
                    bgcolor: isActive ? 'action.selected' : 'transparent',
                  }}
                >
                  <IconButton
                    size="small"
                    aria-label={layer.visible ? t('layerHide') : t('layerShow')}
                    aria-pressed={!layer.visible}
                    onClick={() => {
                      strokeManager.updateLayer(layer.id, { visible: !layer.visible });
                      change();
                    }}
                  >
                    {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={layer.locked ? t('layerUnlock') : t('layerLock')}
                    aria-pressed={layer.locked}
                    onClick={() => {
                      strokeManager.updateLayer(layer.id, { locked: !layer.locked });
                      change();
                    }}
                    sx={{ color: layer.locked ? 'warning.main' : 'text.disabled' }}
                  >
                    {layer.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                  </IconButton>
                  <ButtonBase
                    aria-pressed={isActive}
                    aria-label={`${t('layerSelect')}: ${layerDisplayName(layer, index)}`}
                    onClick={() => {
                      if (strokeManager.setActiveLayer(layer.id)) {
                        setConfirm(null);
                        // Active layer is persisted but doesn't change the drawing.
                        change();
                      }
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      py: 0.75,
                      px: 0.5,
                      borderRadius: 1,
                      justifyContent: 'flex-start',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box
                      component="span"
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        bgcolor: LAYER_COLOR_HEX[layer.color],
                        opacity: layer.opacity,
                      }}
                    />
                    <Typography
                      component="span"
                      variant="body2"
                      noWrap
                      sx={{
                        flex: 1,
                        textAlign: 'left',
                        fontWeight: isActive ? 700 : 400,
                        opacity: layer.visible ? 1 : 0.5,
                      }}
                    >
                      {layerDisplayName(layer, index)}
                    </Typography>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {strokeManager.getLayerStrokeCount(layer.id)}
                    </Typography>
                  </ButtonBase>
                </Box>
              );
            })}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={16} />}
            disabled={layers.length >= MAX_LAYERS}
            onClick={() => {
              strokeManager.addLayer();
              setConfirm(null);
              change();
            }}
            sx={{ flex: 1, textTransform: 'none' }}
          >
            {t('layerAdd')}
          </Button>
          {!multi && (
            <Button
              size="small"
              variant="outlined"
              onClick={handlePreset}
              sx={{ flex: 1, textTransform: 'none' }}
            >
              {t('layerPresetDraftInk')}
            </Button>
          )}
        </Box>

        {/* Settings of the active layer. */}
        <Box
          sx={{
            borderTop: '1px solid #ddd',
            pt: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <TextField
            size="small"
            label={t('layerName')}
            placeholder={layerDisplayName({ ...active, name: '' }, activeIndex)}
            value={active.name}
            onChange={(e) => {
              strokeManager.updateLayer(active.id, { name: e.target.value });
              change(false);
            }}
            onBlur={() => change()}
            slotProps={{ htmlInput: { maxLength: 32 } }}
          />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={active.color}
            onChange={(_e, value: LayerColor | null) => {
              if (!value) return;
              strokeManager.updateLayer(active.id, { color: value });
              change();
            }}
            aria-label={t('layerColor')}
          >
            {COLOR_OPTIONS.map(({ value, labelKey }) => (
              <ToggleButton
                key={value}
                value={value}
                sx={{ flex: 1, gap: 0.5, textTransform: 'none' }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: LAYER_COLOR_HEX[value],
                  }}
                />
                {t(labelKey)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {showFrameOptions && (
            <FormControlLabel
              sx={{ mx: 0.5 }}
              control={
                <Switch
                  size="small"
                  checked={active.shared === true}
                  onChange={(e) => {
                    strokeManager.updateLayer(active.id, { shared: e.target.checked });
                    change();
                  }}
                />
              }
              label={<Typography variant="body2">{t('layerShared')}</Typography>}
            />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1 }}>
            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
              {t('layerOpacity')}
            </Typography>
            <Slider
              size="small"
              min={10}
              max={100}
              step={5}
              value={Math.round(active.opacity * 100)}
              aria-label={t('layerOpacity')}
              onChange={(_e, v) => {
                strokeManager.updateLayer(active.id, { opacity: (v as number) / 100 });
                change(false);
              }}
              onChangeCommitted={() => change()}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ToolbarTooltip title={t('layerMoveUp')}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t('layerMoveUp')}
                  disabled={activeIndex >= layers.length - 1}
                  onClick={() => {
                    strokeManager.moveLayer(active.id, 1);
                    change();
                  }}
                >
                  <ArrowUp size={18} />
                </IconButton>
              </span>
            </ToolbarTooltip>
            <ToolbarTooltip title={t('layerMoveDown')}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t('layerMoveDown')}
                  disabled={activeIndex <= 0}
                  onClick={() => {
                    strokeManager.moveLayer(active.id, -1);
                    change();
                  }}
                >
                  <ArrowDown size={18} />
                </IconButton>
              </span>
            </ToolbarTooltip>
            <Box sx={{ flex: 1 }} />
            {pendingConfirm ? (
              <>
                <Typography variant="caption" sx={{ mr: 0.5 }}>
                  {pendingConfirm === 'delete' ? t('layerDeleteConfirm') : t('layerClearConfirm')}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={pendingConfirm === 'delete' ? t('layerDelete') : t('layerClear')}
                  sx={{ color: 'error.main' }}
                  onClick={() => {
                    if (pendingConfirm === 'delete') strokeManager.deleteLayer(active.id);
                    else strokeManager.clearLayer(active.id);
                    setConfirm(null);
                    change();
                  }}
                >
                  <Check size={18} />
                </IconButton>
                <IconButton size="small" aria-label={t('cancel')} onClick={() => setConfirm(null)}>
                  <X size={18} />
                </IconButton>
              </>
            ) : (
              <>
                <ToolbarTooltip title={t('layerClear')}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('layerClear')}
                      // Same protection as the eraser: a hidden / locked
                      // layer can't be bulk-erased either.
                      disabled={blocked || strokeManager.getLayerStrokeCount(active.id) === 0}
                      onClick={() => setConfirm({ kind: 'clear', layerId: active.id })}
                    >
                      <Eraser size={18} />
                    </IconButton>
                  </span>
                </ToolbarTooltip>
                <ToolbarTooltip title={t('layerDelete')}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('layerDelete')}
                      disabled={!multi}
                      sx={{ color: multi ? 'error.main' : undefined }}
                      onClick={() => {
                        // Empty layers go without asking; undo covers both anyway.
                        if (strokeManager.getLayerStrokeCount(active.id) === 0) {
                          strokeManager.deleteLayer(active.id);
                          change();
                        } else {
                          setConfirm({ kind: 'delete', layerId: active.id });
                        }
                      }}
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  </span>
                </ToolbarTooltip>
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
