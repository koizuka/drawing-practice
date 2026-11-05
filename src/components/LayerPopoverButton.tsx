import { useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Popover,
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

interface LayerPopoverButtonProps {
  strokeManager: StrokeManager;
  /**
   * Called after every layer mutation. `flush: true` for discrete edits
   * (persist immediately); omitted for continuous ones (slider drag, typing)
   * which ride the 2s autosave debounce.
   */
  onChanged: (opts?: { flush?: boolean }) => void;
  /** Show animation-only layer settings (the "all frames" switch). */
  showFrameOptions?: boolean;
}

/**
 * Drawing-toolbar layer manager (see docs/layers.md). Reads the layer list
 * inline from the StrokeManager on each render — the parent re-renders after
 * `onChanged`, same pattern as canUndo/canRedo.
 */
export function LayerPopoverButton({
  strokeManager,
  onChanged,
  showFrameOptions = false,
}: LayerPopoverButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
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

  const tooltip = blocked
    ? t('layerBlocked')
    : multi
      ? `${t('layers')}: ${layerDisplayName(active, activeIndex)}`
      : t('layers');

  return (
    <>
      <ToolbarTooltip title={tooltip}>
        <IconButton
          size="small"
          aria-label={t('layers')}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            position: 'relative',
            color: blocked ? 'warning.main' : multi ? 'primary.main' : 'inherit',
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
      <Popover
        open={anchorEl !== null}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(null);
          setConfirm(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Box sx={{ p: 1, width: 280, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Layer list, top layer first (as in every paint app). */}
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
                  <IconButton
                    size="small"
                    aria-label={t('cancel')}
                    onClick={() => setConfirm(null)}
                  >
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
      </Popover>
    </>
  );
}
