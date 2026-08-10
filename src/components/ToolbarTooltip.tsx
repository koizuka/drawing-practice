import { Tooltip, type TooltipProps } from '@mui/material';

export function ToolbarTooltip(props: TooltipProps) {
  return (
    <Tooltip
      disableTouchListener
      disableFocusListener
      // Without this, MUI keeps the popper interactive (pointer-events: auto)
      // so a tooltip lingering after a tap swallows the tap aimed at whatever
      // sits beneath it (e.g. the perspective-memory row: tapping [1] shows a
      // tooltip right on top of the trash button below). Our tooltips are
      // plain labels — never clickable content — so let taps pass through.
      disableInteractive
      {...props}
    />
  );
}
