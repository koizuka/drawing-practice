import { useState } from 'react';
import { IconButton, Popover, ToggleButton, ToggleButtonGroup, Box } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import type { GridMode, GridSettings } from '../guides/types';

export function GridIcon({ mode }: { mode: GridMode }) {
  const size = 20;
  const color = 'currentColor';
  if (mode === 'none') {
    // Empty square outline — no grid
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5">
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

const GRID_MODE_OPTIONS: { mode: GridMode; labelKey: 'gridModeNone' | 'gridModeNormal' | 'gridModeLarge' | 'gridModePerspective' }[] = [
  { mode: 'none', labelKey: 'gridModeNone' },
  { mode: 'normal', labelKey: 'gridModeNormal' },
  { mode: 'large', labelKey: 'gridModeLarge' },
  { mode: 'perspective', labelKey: 'gridModePerspective' },
];

/**
 * Toolbar button opening a popover with the exclusive grid-mode selection
 * (none / normal / large / perspective). Replaces the former cycle-tap
 * button — four modes made cycling too costly to reach a specific one.
 */
export function GridModePopoverButton({
  grid,
  onSetGridMode,
}: {
  grid: GridSettings;
  onSetGridMode: (mode: GridMode) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const active = grid.mode !== 'none';

  return (
    <>
      <ToolbarTooltip title={t('gridMenu')}>
        <IconButton
          size="small"
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{
            'bgcolor': active ? 'info.main' : 'transparent',
            'color': active ? 'white' : 'inherit',
            '&:hover': { bgcolor: active ? 'info.dark' : 'action.hover' },
          }}
        >
          <GridIcon mode={grid.mode} />
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
          value={grid.mode}
          onChange={(_e, mode: GridMode | null) => {
            if (mode !== null) {
              onSetGridMode(mode);
              setAnchorEl(null);
            }
          }}
          sx={{ p: 0.5 }}
        >
          {GRID_MODE_OPTIONS.map(({ mode, labelKey }) => (
            <ToggleButton key={mode} value={mode} sx={{ justifyContent: 'flex-start', gap: 1, px: 1.5, border: 'none' }}>
              <GridIcon mode={mode} />
              <Box component="span" sx={{ textTransform: 'none' }}>{t(labelKey)}</Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Popover>
    </>
  );
}
