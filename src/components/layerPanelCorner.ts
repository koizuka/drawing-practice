/** Which corner of the drawing canvas area the layer panel is docked to. */
export type PanelCorner = 'tl' | 'tr' | 'bl' | 'br';
export const PANEL_CORNERS: readonly PanelCorner[] = ['tl', 'tr', 'bl', 'br'];

/** Parse a persisted preference; anything unknown falls back to top-left. */
export function parsePanelCorner(v: string | null): PanelCorner {
  return (PANEL_CORNERS as readonly (string | null)[]).includes(v) ? (v as PanelCorner) : 'tl';
}
