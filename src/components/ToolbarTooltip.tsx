import { Tooltip, type TooltipProps } from '@mui/material';

export function ToolbarTooltip(props: TooltipProps) {
  return (
    <Tooltip
      disableTouchListener
      disableFocusListener
      {...props}
    />
  );
}
