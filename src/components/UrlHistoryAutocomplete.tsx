import { Autocomplete, Box, Button, IconButton, TextField, Typography } from '@mui/material';
import { Boxes, Camera, Film, Image as ImageIcon, Trash2 } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { resolveHistoryThumbnailSrc } from './urlHistoryThumbnail';
import { t } from '../i18n';
import { parseYouTubeVideoId } from '../utils/youtube';
import { parseSketchfabModelUrl } from '../utils/sketchfab';
import type { UrlHistoryEntry, UrlHistoryType } from '../storage';
import type { UrlHistoryThumbnails } from '../hooks/useUrlHistoryThumbnails';

function describeHistoryUrl(entry: UrlHistoryEntry): { primary: string; secondary: string } {
  if (entry.type === 'image') {
    return {
      primary: entry.fileName ?? entry.title ?? t('localImage'),
      secondary: t('localImage'),
    };
  }
  if (entry.title) return { primary: entry.title, secondary: entry.url };
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url);
    return { primary: id ? `YouTube · ${id}` : entry.url, secondary: entry.url };
  }
  let parsed: URL;
  try {
    parsed = new URL(entry.url);
  } catch {
    return { primary: entry.url, secondary: '' };
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (entry.type === 'pexels') {
    const photoIndex = segments.indexOf('photo');
    const slug = photoIndex >= 0 ? segments[photoIndex + 1] : undefined;
    return { primary: slug ? `Pexels · ${slug}` : entry.url, secondary: entry.url };
  }
  if (entry.type === 'sketchfab') {
    const sketchfabMatch = parseSketchfabModelUrl(entry.url);
    return {
      primary: sketchfabMatch ? `Sketchfab · ${sketchfabMatch.uid.slice(0, 8)}` : entry.url,
      secondary: entry.url,
    };
  }
  const filename = segments.pop();
  return { primary: filename || parsed.hostname, secondary: parsed.hostname };
}

function HistoryTypeIcon({ type }: { type: UrlHistoryType }) {
  if (type === 'youtube') return <Film size={14} />;
  if (type === 'pexels') return <Camera size={14} />;
  if (type === 'sketchfab') return <Boxes size={14} />;
  // 'image' and 'url' both render with the generic image glyph.
  return <ImageIcon size={14} />;
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

interface UrlHistoryAutocompleteProps {
  history: readonly UrlHistoryEntry[];
  thumbnails: UrlHistoryThumbnails;
  inputValue: string;
  /** User typed / cleared the input (selection-driven changes are not reported). */
  onInputChange: (value: string) => void;
  /** A history row was picked. */
  onSelectEntry: (entry: UrlHistoryEntry) => void;
  /** Enter or the Load button with a non-empty input. */
  onSubmit: (url: string) => void;
  onDeleteEntry: (url: string) => void;
  loading: boolean;
}

/**
 * URL input with the URL-history dropdown (thumbnail / type icon, title,
 * per-row delete) plus the Load button. Thumbnail state comes from
 * `useUrlHistoryThumbnails` in the parent.
 */
export function UrlHistoryAutocomplete({
  history,
  thumbnails,
  inputValue,
  onInputChange,
  onSelectEntry,
  onSubmit,
  onDeleteEntry,
  loading,
}: UrlHistoryAutocompleteProps) {
  const { blobThumbUrls, thumbErrors, markThumbError } = thumbnails;

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Autocomplete<UrlHistoryEntry, false, false, true>
        freeSolo
        size="small"
        sx={{ flex: 1 }}
        fullWidth
        options={history as UrlHistoryEntry[]}
        filterOptions={(x) => x}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          // Synthetic `local:<hash>` keys are not meaningful to the
          // user; show the file name instead.
          if (option.type === 'image') return option.fileName ?? '';
          return option.url;
        }}
        isOptionEqualToValue={(a, b) =>
          typeof a !== 'string' && typeof b !== 'string' && a.url === b.url
        }
        inputValue={inputValue}
        onInputChange={(_, value, reason) => {
          if (reason === 'input' || reason === 'clear') onInputChange(value);
        }}
        onChange={(_, value, reason) => {
          if (reason === 'selectOption' && value && typeof value !== 'string') {
            onSelectEntry(value);
          }
        }}
        renderOption={(props, option) => {
          const { key, ...rest } = props as typeof props & { key: string };
          const { primary, secondary } = describeHistoryUrl(option);
          const thumbSrc = resolveHistoryThumbnailSrc(option, blobThumbUrls);
          const showThumb = thumbSrc !== null && !thumbErrors.has(option.url);
          return (
            <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'text.secondary',
                  bgcolor: showThumb ? 'action.hover' : 'transparent',
                  borderRadius: 0.5,
                  overflow: 'hidden',
                }}
              >
                {showThumb ? (
                  <Box
                    component="img"
                    src={thumbSrc}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => markThumbError(option.url)}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <HistoryTypeIcon type={option.type} />
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={ellipsis}>
                  {primary}
                </Typography>
                {secondary && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', ...ellipsis }}
                  >
                    {secondary}
                  </Typography>
                )}
              </Box>
              <ToolbarTooltip title={t('urlHistoryDelete')}>
                <IconButton
                  size="small"
                  aria-label={t('urlHistoryDelete')}
                  // Touch devices commit option selection on pointerdown
                  // (before click), so we have to stop propagation there
                  // too — not just on click.
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteEntry(option.url);
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </ToolbarTooltip>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            placeholder={t('urlPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue) {
                e.preventDefault();
                onSubmit(inputValue);
              }
            }}
          />
        )}
      />
      <Button
        size="small"
        variant="outlined"
        onClick={() => onSubmit(inputValue)}
        disabled={!inputValue || loading}
      >
        {t('loadUrl')}
      </Button>
    </Box>
  );
}
