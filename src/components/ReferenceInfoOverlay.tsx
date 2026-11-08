import { useState } from 'react';
import { Box, IconButton, Typography, Link as MuiLink } from '@mui/material';
import { Info, X } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { t } from '../i18n';
import { canonicalSketchfabUrl } from '../utils/sketchfab';
import type { ReferenceInfo } from '../types';

/**
 * Reference-source attribution pill shown over the bottom-left of the
 * reference image. Collapses to a small info icon on user tap so it doesn't
 * cover the lower portion of the reference while drawing. Parent keys this
 * component by reference identity, so a new reference remounts it and
 * re-applies `initialCollapsed` (collapsed during gesture sessions).
 */
export function ReferenceInfoOverlay({
  refInfo,
  initialCollapsed = false,
}: {
  refInfo: ReferenceInfo;
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        // Cap the overall overlay width so long titles / author lines can't
        // push the collapse button off-screen on narrow viewports. The 16px
        // budget accounts for the 8px left offset plus an 8px right gutter.
        maxWidth: 'calc(100% - 16px)',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {collapsed ? (
        <ToolbarTooltip title={t('expandReferenceInfo')}>
          <IconButton
            size="small"
            onClick={() => setCollapsed(false)}
            aria-label={t('expandReferenceInfo')}
            sx={{
              pointerEvents: 'auto',
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
          >
            <Info size={18} />
          </IconButton>
        </ToolbarTooltip>
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.5,
            pointerEvents: 'auto',
            bgcolor: 'rgba(0,0,0,0.5)',
            color: 'white',
            pl: 1,
            pr: 0.5,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {refInfo.title && (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontWeight: 'bold',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {refInfo.title}
              </Typography>
            )}
            {(refInfo.author || (refInfo.source === 'sketchfab' && refInfo.sketchfabUid)) && (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  opacity: 0.9,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {refInfo.source === 'pexels' && refInfo.pexelsPhotographerUrl ? (
                  <>
                    {t('pexelsPhotoBy')}{' '}
                    <MuiLink
                      href={refInfo.pexelsPhotographerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                      {refInfo.author}
                    </MuiLink>
                    {refInfo.pexelsPageUrl && (
                      <>
                        {' · '}
                        <MuiLink
                          href={refInfo.pexelsPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ color: 'inherit', textDecoration: 'underline' }}
                        >
                          {t('pexelsViaPexels')}
                        </MuiLink>
                      </>
                    )}
                  </>
                ) : refInfo.source === 'sketchfab' && refInfo.sketchfabUid ? (
                  <>
                    {refInfo.author}
                    {refInfo.author && ' · '}
                    <MuiLink
                      href={canonicalSketchfabUrl(refInfo.sketchfabUid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                      {t('sketchfabViaSketchfab')}
                    </MuiLink>
                  </>
                ) : (
                  refInfo.author
                )}
              </Typography>
            )}
          </Box>
          <ToolbarTooltip title={t('collapseReferenceInfo')}>
            <IconButton
              size="small"
              onClick={() => setCollapsed(true)}
              aria-label={t('collapseReferenceInfo')}
              sx={{
                flexShrink: 0,
                color: 'white',
                p: 0.25,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
              }}
            >
              <X size={14} />
            </IconButton>
          </ToolbarTooltip>
        </Box>
      )}
    </Box>
  );
}
