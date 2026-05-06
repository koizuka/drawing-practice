import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Trash2 } from 'lucide-react';
import {
  buildPexelsReferenceInfo,
  getPexelsApiKey,
  getPexelsLastSearch,
  isAbortError,
  mapPexelsErrorKey,
  searchPhotos,
  setPexelsLastSearch,
  type PexelsOrientationFilter as Orientation,
  type PexelsPhoto,
} from '../utils/pexels';
import {
  addPexelsSearchHistory,
  deletePexelsSearchHistory,
  getPexelsSearchHistory,
  type PexelsSearchHistoryEntry,
} from '../storage';
import type { ReferenceInfo } from '../types';
import { t } from '../i18n';
import { ToolbarTooltip } from './ToolbarTooltip';
import { resetPageZoom } from '../utils/resetPageZoom';

interface PexelsSearcherProps {
  onSelectPhoto: (info: Extract<ReferenceInfo, { source: 'pexels' }>, thumbnailUrl: string) => void;
  /** Fired when the API key is missing or rejected. Must be stable (useCallback) —
   *  effect deps include this and an unstable identity would re-fire while needsKey stays true. */
  onApiKeyMissing: () => void;
  initialQuery?: string;
  initialOrientation?: Orientation;
  /** Bumped by parent when the API key changes so the searcher re-evaluates key state. */
  apiKeyVersion?: number;
}

function orientationLabel(o: Orientation): string {
  switch (o) {
    case 'landscape': return t('pexelsOrientationLandscape');
    case 'portrait': return t('pexelsOrientationPortrait');
    case 'square': return t('pexelsOrientationSquare');
    case 'all': return t('pexelsOrientationAll');
  }
}

const SUGGESTED_QUERIES: { label: string; query: string }[] = [
  { label: 'pose', query: 'pose reference' },
  { label: 'figure', query: 'figure' },
  { label: 'portrait', query: 'portrait' },
  { label: 'dance', query: 'dance' },
  { label: 'ballet', query: 'ballet' },
  { label: 'yoga', query: 'yoga' },
  { label: 'martial arts', query: 'martial arts' },
  { label: 'gymnastics', query: 'gymnastics' },
  { label: 'athlete', query: 'athlete' },
  { label: 'hand', query: 'hand' },
];

export function PexelsSearcher({ onSelectPhoto, onApiKeyMissing, initialQuery, initialOrientation, apiKeyVersion = 0 }: PexelsSearcherProps) {
  // Restore the prior search so navigating back to the searcher shows results
  // rather than an empty grid. initial* props (passed by the parent when
  // loading from URL history with per-photo context) take precedence over the
  // global last-search snapshot in localStorage.
  const lastSearch = useMemo(() => getPexelsLastSearch(), []);
  const [query, setQuery] = useState(initialQuery ?? lastSearch?.query ?? '');
  const [orientation, setOrientation] = useState<Orientation>(initialOrientation ?? lastSearch?.orientation ?? 'all');
  const [photos, setPhotos] = useState<PexelsPhoto[]>([]);
  const [activeQuery, setActiveQuery] = useState('');
  const [activeOrientation, setActiveOrientation] = useState<Orientation>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(() => getPexelsApiKey() === '');
  // Re-check needsKey when the parent bumps apiKeyVersion (e.g. after the
  // settings dialog stores a new key). Using the render-time prev-prop pattern
  // instead of an effect so we don't violate react-hooks/set-state-in-effect.
  const [prevApiKeyVersion, setPrevApiKeyVersion] = useState(apiKeyVersion);
  if (prevApiKeyVersion !== apiKeyVersion) {
    setPrevApiKeyVersion(apiKeyVersion);
    setNeedsKey(getPexelsApiKey() === '');
  }

  // Abort the in-flight search when a new one starts or when unmounting, so
  // a slow earlier response can't overwrite a faster later one.
  const inflightRef = useRef<AbortController | null>(null);
  useEffect(() => () => inflightRef.current?.abort(), []);

  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchInputRef.current?.focus(); }, []);

  useEffect(() => {
    if (needsKey) onApiKeyMissing();
  }, [needsKey, onApiKeyMissing]);

  const [searchHistory, setSearchHistory] = useState<PexelsSearchHistoryEntry[]>([]);
  const reloadHistory = useCallback(() => {
    getPexelsSearchHistory().then(setSearchHistory).catch(() => { /* ignore */ });
  }, []);
  useEffect(() => { reloadHistory(); }, [reloadHistory]);

  /** Map a Pexels error to user-visible error text. Returns null for key-related
   *  errors — those flip needsKey, which fires onApiKeyMissing for parent recovery. */
  const handleError = useCallback((e: unknown): string | null => {
    const key = mapPexelsErrorKey(e);
    if (key === 'pexelsKeyRequired' || key === 'pexelsKeyInvalid') {
      setNeedsKey(true);
      return null;
    }
    if (key === 'pexelsNetworkError') console.error('Pexels error:', e);
    return t(key);
  }, []);

  // orientation is taken as an explicit argument so history-row selection can
  // search with the saved orientation in the same tick, instead of waiting
  // for setOrientation's render before the closure picks it up.
  const runSearch = useCallback(async (q: string, o: Orientation) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const res = await searchPhotos({
        query: trimmed,
        page: 1,
        orientation: o === 'all' ? undefined : o,
      }, ctrl.signal);
      setPhotos(res.photos);
      setActiveQuery(trimmed);
      setActiveOrientation(o);
      setCurrentPage(1);
      setHasMore(!!res.next_page && res.photos.length > 0);
      setPexelsLastSearch(trimmed, o);
      void addPexelsSearchHistory(trimmed, o).then(reloadHistory).catch(() => { /* ignore */ });
    }
    catch (e) {
      if (isAbortError(e)) return;
      setError(handleError(e));
      setPhotos([]);
      setHasMore(false);
    }
    finally {
      if (inflightRef.current === ctrl) {
        inflightRef.current = null;
        setLoading(false);
      }
    }
  }, [handleError, reloadHistory]);

  // On first mount, if a saved query was restored (and the API key is set),
  // re-run that search so "back to search" from a URL-history-loaded fixed
  // photo lands on results instead of an empty grid. Deferred to a microtask
  // so runSearch's setLoading() doesn't fire synchronously inside the effect.
  useEffect(() => {
    if (!query.trim() || needsKey) return;
    queueMicrotask(() => { void runSearch(query, orientation); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only auto-restore
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !activeQuery) return;
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;

    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const res = await searchPhotos({
        query: activeQuery,
        page: nextPage,
        orientation: activeOrientation === 'all' ? undefined : activeOrientation,
      }, ctrl.signal);
      setPhotos(prev => [...prev, ...res.photos]);
      setCurrentPage(nextPage);
      setHasMore(!!res.next_page && res.photos.length > 0);
    }
    catch (e) {
      if (isAbortError(e)) return;
      setError(handleError(e));
    }
    finally {
      if (inflightRef.current === ctrl) {
        inflightRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [hasMore, loadingMore, activeQuery, activeOrientation, currentPage, handleError]);

  const handleSelect = useCallback((photo: PexelsPhoto) => {
    resetPageZoom();
    onSelectPhoto(buildPexelsReferenceInfo(photo), photo.src.tiny);
  }, [onSelectPhoto]);

  const handleChip = useCallback((preset: string) => {
    setQuery(preset);
    void runSearch(preset, orientation);
  }, [runSearch, orientation]);

  const handleSelectHistory = useCallback((entry: PexelsSearchHistoryEntry) => {
    setQuery(entry.query);
    setOrientation(entry.orientation);
    void runSearch(entry.query, entry.orientation);
  }, [runSearch]);

  const handleDeleteHistory = useCallback((key: string) => {
    void deletePexelsSearchHistory(key).then(reloadHistory).catch(() => { /* ignore */ });
  }, [reloadHistory]);

  return (
    <Box data-allow-page-zoom="true" sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto', p: 1, touchAction: 'pan-x pan-y pinch-zoom' }}>
      {/* Search row — Autocomplete shows the past-searches dropdown. */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Autocomplete<PexelsSearchHistoryEntry, false, false, true>
          freeSolo
          size="small"
          sx={{ flex: 1 }}
          fullWidth
          options={searchHistory}
          filterOptions={x => x}
          getOptionLabel={option => typeof option === 'string' ? option : option.query}
          isOptionEqualToValue={(a, b) => typeof a !== 'string' && typeof b !== 'string' && a.key === b.key}
          inputValue={query}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') setQuery(value);
          }}
          onChange={(_, value, reason) => {
            if (reason === 'selectOption' && value && typeof value !== 'string') {
              handleSelectHistory(value);
            }
          }}
          disabled={needsKey}
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: string };
            return (
              <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {option.query}
                </Box>
                {option.orientation !== 'all' && (
                  <Chip size="small" variant="outlined" label={orientationLabel(option.orientation)} />
                )}
                <ToolbarTooltip title={t('pexelsSearchHistoryDelete')}>
                  <IconButton
                    size="small"
                    aria-label={t('pexelsSearchHistoryDelete')}
                    // Touch devices commit option selection on pointerdown
                    // (before click), so stop propagation there too.
                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onClick={(e) => { e.stopPropagation(); handleDeleteHistory(option.key); }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </ToolbarTooltip>
              </li>
            );
          }}
          renderInput={params => (
            <TextField
              {...params}
              inputRef={searchInputRef}
              size="small"
              placeholder={t('pexelsSearchPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  e.preventDefault();
                  void runSearch(query, orientation);
                }
              }}
            />
          )}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => void runSearch(query, orientation)}
          disabled={needsKey || !query.trim() || loading}
        >
          {t('search')}
        </Button>
      </Box>

      {/* Orientation filter */}
      <ToggleButtonGroup
        value={orientation}
        exclusive
        size="small"
        onChange={(_e, val) => {
          if (val === null) return;
          setOrientation(val as Orientation);
        }}
        sx={{ mb: 1 }}
      >
        <ToggleButton value="all">{t('pexelsOrientationAll')}</ToggleButton>
        <ToggleButton value="landscape">{t('pexelsOrientationLandscape')}</ToggleButton>
        <ToggleButton value="portrait">{t('pexelsOrientationPortrait')}</ToggleButton>
        <ToggleButton value="square">{t('pexelsOrientationSquare')}</ToggleButton>
      </ToggleButtonGroup>

      {/* Suggested chips */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
        {SUGGESTED_QUERIES.map(s => (
          <Chip
            key={s.label}
            label={s.label}
            size="small"
            variant="outlined"
            onClick={() => handleChip(s.query)}
            disabled={needsKey}
          />
        ))}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && photos.length > 0 && (
        <>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 1,
          }}
          >
            {photos.map(photo => (
              <Box
                key={photo.id}
                onClick={() => handleSelect(photo)}
                sx={{
                  'cursor': 'pointer',
                  'border': '1px solid #ddd',
                  'borderRadius': 1,
                  'overflow': 'hidden',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <img
                  src={photo.src.medium}
                  alt={photo.alt || `Photo #${photo.id}`}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <Typography variant="caption" sx={{ display: 'block', px: 0.5, py: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {photo.photographer}
                </Typography>
              </Box>
            ))}
          </Box>
          {hasMore && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
              <Button
                variant="outlined"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}
              >
                {t('loadMore')}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
