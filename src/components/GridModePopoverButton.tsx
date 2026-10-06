import { useState } from 'react';
import { IconButton, Popover, ToggleButton, ToggleButtonGroup, Box } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import type { GridMode, GridSettings, PerspectiveShape } from '../guides/types';

export function GridIcon({ mode, shape = 'room' }: { mode: GridMode; shape?: PerspectiveShape }) {
  const size = 20;
  const color = 'currentColor';
  if (mode === 'perspective' && shape === 'box') {
    // Wireframe cube, far edges dashed
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <path
          d="M2 7 L12 7 L12 18 L2 18 Z M2 7 L8 2 L18 2 L12 7 M18 2 L18 13 L12 18"
          strokeWidth="1.3"
        />
        <path d="M2 18 L8 13 L18 13 M8 2 L8 13" strokeWidth="0.8" strokeDasharray="1.5 1.2" />
      </svg>
    );
  }
  if (mode === 'perspective' && shape === 'head') {
    // Loomis head: cranium circle, brow / center lines, jaw
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <circle cx="10" cy="8" r="6.5" strokeWidth="1.3" />
        <path d="M4.5 9.5 L7 15.5 L10 18.5 L13 15.5 L15.5 9.5" strokeWidth="1.3" />
        <line x1="3.5" y1="8" x2="16.5" y2="8" strokeWidth="0.8" />
        <line x1="10" y1="1.5" x2="10" y2="18.5" strokeWidth="0.8" />
      </svg>
    );
  }
  if (mode === 'none') {
    // Empty square outline — no grid
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
      >
        <rect x="1" y="1" width="18" height="18" rx="1" />
      </svg>
    );
  }
  if (mode === 'large') {
    // 2x2 grid with thick center lines
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
        <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2.5" />
        <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2.5" />
      </svg>
    );
  }
  if (mode === 'perspective') {
    // Floor lines converging on a horizon vanishing point
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
        <line x1="1" y1="7" x2="19" y2="7" strokeWidth="1" />
        <line x1="1" y1="19" x2="10" y2="7" strokeWidth="1" />
        <line x1="19" y1="19" x2="10" y2="7" strokeWidth="1" />
        <line x1="5.5" y1="19" x2="10" y2="7" strokeWidth="0.7" />
        <line x1="14.5" y1="19" x2="10" y2="7" strokeWidth="0.7" />
      </svg>
    );
  }
  // normal: 4x4 grid with thick center lines
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
      <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
      {/* Thin grid lines */}
      <line x1="5.5" y1="1" x2="5.5" y2="19" strokeWidth="0.7" />
      <line x1="14.5" y1="1" x2="14.5" y2="19" strokeWidth="0.7" />
      <line x1="1" y1="5.5" x2="19" y2="5.5" strokeWidth="0.7" />
      <line x1="1" y1="14.5" x2="19" y2="14.5" strokeWidth="0.7" />
      {/* Thick center lines */}
      <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2" />
      <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2" />
    </svg>
  );
}

const GRID_MODE_OPTIONS: {
  /** ToggleButton value: the mode, or `perspective:<shape>` for perspective shapes. */
  key: string;
  mode: GridMode;
  shape?: PerspectiveShape;
  labelKey:
    | 'gridModeNone'
    | 'gridModeNormal'
    | 'gridModeLarge'
    | 'gridModePerspective'
    | 'gridModePerspectiveBox'
    | 'gridModePerspectiveHead';
}[] = [
  { key: 'none', mode: 'none', labelKey: 'gridModeNone' },
  { key: 'normal', mode: 'normal', labelKey: 'gridModeNormal' },
  { key: 'large', mode: 'large', labelKey: 'gridModeLarge' },
  { key: 'perspective:room', mode: 'perspective', shape: 'room', labelKey: 'gridModePerspective' },
  { key: 'perspective:box', mode: 'perspective', shape: 'box', labelKey: 'gridModePerspectiveBox' },
  {
    key: 'perspective:head',
    mode: 'perspective',
    shape: 'head',
    labelKey: 'gridModePerspectiveHead',
  },
];

/**
 * Toolbar button opening a popover with the exclusive grid-mode selection
 * (none / normal / large / one entry per perspective shape). Replaces the
 * former cycle-tap button — too many modes to reach a specific one by cycling.
 */
export function GridModePopoverButton({
  grid,
  onSetGridMode,
}: {
  grid: GridSettings;
  onSetGridMode: (mode: GridMode, shape?: PerspectiveShape) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const active = grid.mode !== 'none';
  const shape = grid.perspectiveShape ?? 'room';
  const selectedKey = grid.mode === 'perspective' ? `perspective:${shape}` : grid.mode;

  return (
    <>
      <ToolbarTooltip title={t('gridMenu')}>
        <IconButton
          size="small"
          aria-label={t('gridMenu')}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            bgcolor: active ? 'info.main' : 'transparent',
            color: active ? 'white' : 'inherit',
            '&:hover': { bgcolor: active ? 'info.dark' : 'action.hover' },
          }}
        >
          <GridIcon mode={grid.mode} shape={shape} />
        </IconButton>
      </ToolbarTooltip>
      <Popover
        open={anchorEl !== null}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <ToggleButtonGroup
          orientation="vertical"
          exclusive
          size="small"
          value={selectedKey}
          onChange={(_e, key: string | null) => {
            const option = GRID_MODE_OPTIONS.find((o) => o.key === key);
            if (option) {
              onSetGridMode(option.mode, option.shape);
              setAnchorEl(null);
            }
          }}
          sx={{ p: 0.5 }}
        >
          {GRID_MODE_OPTIONS.map(({ key, mode, shape: optionShape, labelKey }) => (
            <ToggleButton
              key={key}
              value={key}
              sx={{ justifyContent: 'flex-start', gap: 1, px: 1.5, border: 'none' }}
            >
              <GridIcon mode={mode} shape={optionShape} />
              <Box component="span" sx={{ textTransform: 'none' }}>
                {t(labelKey)}
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Popover>
    </>
  );
}
