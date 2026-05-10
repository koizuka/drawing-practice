import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, IconButton, Button, Checkbox, ToggleButton, ToggleButtonGroup, Menu, MenuItem } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { X, Trash2, ChevronDown, ChevronRight, Download } from 'lucide-react';
import {
  getAllDrawings,
  bulkDeleteDrawings,
  computeStorageUsage,
  formatBytes,
  type DrawingRecord,
  type StorageUsage,
} from '../storage';
import { exportDrawing, type ExportFormat } from '../storage/exportDrawing';
import { getUrlHistoryEntry } from '../storage/urlHistoryStore';
import { formatTime } from '../hooks/useTimer';
import { t } from '../i18n';
import { referenceKey, type ReferenceInfo } from '../types';
import {
  buildGroups,
  canLoadReference,
  loadGroupMode,
  persistGroupMode,
  refLabelOf,
  syncThumbUrl,
  type GroupMode,
} from './galleryGrouping';

const dayFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });

function formatGroupDateLabel(
  mode: GroupMode,
  firstUsedAt: Date,
  lastUsedAt: Date,
): string | null {
  if (mode === 'ref-first') return `${t('groupLabelFirstUsed')}: ${dayFormatter.format(firstUsedAt)}`;
  if (mode === 'ref-recent') return `${t('groupLabelRecentUsed')}: ${dayFormatter.format(lastUsedAt)}`;
  return null;
}

interface GalleryProps {
  onClose: () => void;
  onLoadReference?: (info: ReferenceInfo) => void;
}

export function Gallery({ onClose, onLoadReference }: GalleryProps) {
  const [drawings, setDrawings] = useState<DrawingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupModeState] = useState<GroupMode>(loadGroupMode);
  const [imageThumbs, setImageThumbs] = useState<Record<string, string | null>>({});
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const enqueuedKeysRef = useRef<Set<string>>(new Set());
  const objectUrlsRef = useRef<string[]>([]);

  const setGroupMode = useCallback((mode: GroupMode) => {
    setGroupModeState(mode);
    persistGroupMode(mode);
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAllDrawings().then((all) => {
      if (cancelled) return;
      setDrawings(all);
      setLoading(false);
      computeStorageUsage(all).then((u) => {
        if (!cancelled) setUsage(u);
      }).catch(() => { /* ignore */ });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tasks: Array<{ key: string; historyKey: string }> = [];
    for (const d of drawings) {
      const ref = d.reference;
      if (!ref || ref.source !== 'image' || !ref.url) continue;
      const key = referenceKey(ref);
      if (enqueuedKeysRef.current.has(key)) continue;
      enqueuedKeysRef.current.add(key);
      tasks.push({ key, historyKey: ref.url });
    }
    for (const task of tasks) {
      getUrlHistoryEntry(task.historyKey).then((entry) => {
        if (cancelled) return;
        if (entry?.imageBlob) {
          const url = URL.createObjectURL(entry.imageBlob);
          objectUrlsRef.current.push(url);
          setImageThumbs(prev => ({ ...prev, [task.key]: url }));
        }
        else {
          setImageThumbs(prev => ({ ...prev, [task.key]: null }));
        }
      }).catch(() => {
        if (cancelled) return;
        setImageThumbs(prev => ({ ...prev, [task.key]: null }));
      });
    }
    return () => { cancelled = true; };
  }, [drawings]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    };
  }, []);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const idsSnapshot = new Set(selectedIds);
    try {
      await bulkDeleteDrawings([...idsSnapshot]);
    }
    catch (err) {
      console.error('Failed to bulk-delete drawings', err);
      if (mountedRef.current) alert(t('deleteFailed'));
      return;
    }
    if (!mountedRef.current) return;
    const remaining = drawings.filter(d => d.id == null || !idsSnapshot.has(d.id));
    setDrawings(remaining);
    setSelectedIds(new Set());
    computeStorageUsage(remaining).then((u) => {
      if (mountedRef.current) setUsage(u);
    }).catch(() => { /* ignore */ });
  }, [drawings, selectedIds]);

  const handleLoadDrawingReference = useCallback((drawing: DrawingRecord) => {
    const ref = drawing.reference;
    if (!ref) return;
    onLoadReference?.(ref);
    onClose();
  }, [onLoadReference, onClose]);

  const handleLoadGroupReference = useCallback((ref: ReferenceInfo | undefined) => {
    if (!ref) return;
    onLoadReference?.(ref);
    onClose();
  }, [onLoadReference, onClose]);

  const groups = useMemo(
    () => buildGroups(drawings, groupMode, t('ungroupedReferences')),
    [drawings, groupMode],
  );

  const getThumbForRef = useCallback((ref: ReferenceInfo | undefined): string | null => {
    if (!ref) return null;
    if (ref.source === 'image') return imageThumbs[referenceKey(ref)] ?? null;
    return syncThumbUrl(ref);
  }, [imageThumbs]);

  const isRefMode = groupMode !== 'date';

  return (
    <Box sx={{
      position: 'fixed',
      inset: 0,
      bgcolor: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
    >
      <Box sx={{
        bgcolor: 'white',
        borderRadius: 2,
        width: '90vw',
        maxWidth: 900,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      >
        {/* Header */}
        <Box sx={{ borderBottom: '1px solid #ddd', px: 2, py: 1.5 }}>
          {/* Top row: title + close. Pinned together so the X stays at the
              top-right corner even on narrow screens where the toggle row
              below has to wrap. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }}>
              {t('galleryTitle')}
              {' '}
              (
              {drawings.length}
              )
            </Typography>
            <IconButton onClick={onClose} size="small">
              <X size={20} />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', mt: 1, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <ToggleButtonGroup
              value={groupMode}
              exclusive
              size="small"
              onChange={(_e, val) => {
                if (val === null) return;
                setGroupMode(val as GroupMode);
              }}
            >
              <ToggleButton value="date">{t('groupByDate')}</ToggleButton>
              <ToggleButton value="ref-first">{t('groupByRefFirst')}</ToggleButton>
              <ToggleButton value="ref-recent">{t('groupByRefRecent')}</ToggleButton>
            </ToggleButtonGroup>
            {selectedIds.size > 0 && (
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<Trash2 size={16} />}
                onClick={handleBulkDelete}
              >
                {`${t('delete')} (${selectedIds.size})`}
              </Button>
            )}
          </Box>
          {usage && <StorageUsageRow usage={usage} />}
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {loading && (
            <Typography color="text.secondary">{t('loading')}</Typography>
          )}

          {!loading && drawings.length === 0 && (
            <Typography color="text.secondary">{t('noDrawings')}</Typography>
          )}

          {!loading && groups.map((group, gi) => {
            const groupThumb = isRefMode ? getThumbForRef(group.reference) : null;
            const showGroupButton = isRefMode && canLoadReference(group.reference);
            const groupDateLabel = formatGroupDateLabel(groupMode, group.firstUsedAt, group.lastUsedAt);

            return (
              <Box
                key={group.key}
                sx={gi > 0 ? { borderTop: '1px solid #ddd', pt: 2, mt: 2 } : undefined}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {isRefMode && (
                    groupThumb
                      ? (
                          <img
                            src={groupThumb}
                            alt={t('referenceThumbnailAlt')}
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, background: '#fafafa', flexShrink: 0 }}
                          />
                        )
                      : (
                          <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: '#eee', flexShrink: 0 }} />
                        )
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {group.label}
                    </Typography>
                    {groupDateLabel && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {groupDateLabel}
                      </Typography>
                    )}
                  </Box>
                  {showGroupButton && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleLoadGroupReference(group.reference)}
                      sx={{ flexShrink: 0 }}
                    >
                      {t('loadReference')}
                    </Button>
                  )}
                </Box>

                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 2,
                }}
                >
                  {group.drawings.map(drawing => (
                    <DrawingCard
                      key={drawing.id}
                      drawing={drawing}
                      showReferenceLabel={!isRefMode}
                      showReferenceButton={!isRefMode && canLoadReference(drawing.reference)}
                      referenceThumbUrl={!isRefMode ? getThumbForRef(drawing.reference) : null}
                      selected={drawing.id != null && selectedIds.has(drawing.id)}
                      onToggleSelect={toggleSelected}
                      onLoadReference={handleLoadDrawingReference}
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

const STORAGE_USAGE_EXPANDED_KEY = 'gallery.storageUsageExpanded';

function loadStorageUsageExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_USAGE_EXPANDED_KEY) === '1';
  }
  catch { return false; }
}

function persistStorageUsageExpanded(expanded: boolean): void {
  try { localStorage.setItem(STORAGE_USAGE_EXPANDED_KEY, expanded ? '1' : '0'); }
  catch { /* ignore */ }
}

function StorageUsageRow({ usage }: { usage: StorageUsage }) {
  const [expanded, setExpanded] = useState<boolean>(loadStorageUsageExpanded);
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      persistStorageUsageExpanded(next);
      return next;
    });
  }, []);

  const drawingsBytes = usage.drawings.strokes + usage.drawings.thumbnails + usage.drawings.sketchfabImages;
  const totalLogical = drawingsBytes + usage.urlHistoryImageBytes + usage.sessionBytes;
  const breakdownParts = [
    `${t('storageUsageStrokes')} ${formatBytes(usage.drawings.strokes)}`,
    `${t('storageUsageThumbnails')} ${formatBytes(usage.drawings.thumbnails)}`,
    `${t('storageUsageSketchfabImages')} ${formatBytes(usage.drawings.sketchfabImages)}`,
  ];

  return (
    <Box sx={{ mt: 1, color: 'text.secondary' }}>
      <Box
        component="button"
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          background: 'none',
          border: 'none',
          p: 0,
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
          {t('storageUsageTitle')}
          :
          {formatBytes(totalLogical)}
        </Typography>
      </Box>
      {expanded && (
        <Box sx={{ mt: 0.5, pl: 2 }}>
          <Typography variant="caption" component="div">
            {t('storageUsageDrawings')}
            {' '}
            {formatBytes(drawingsBytes)}
            {' '}
            (
            {breakdownParts.join(', ')}
            )
          </Typography>
          {usage.drawings.strokeCount > 0 && (
            <Typography variant="caption" component="div">
              {t('storageUsageStrokeStats')}
              :
              {usage.drawings.strokeCount}
              {' '}
              {t('storageUsageUnitStrokes')}
              {usage.drawings.drawingCount > 0 && ` / ${usage.drawings.drawingCount} ${t('storageUsageUnitDrawings')}`}
              {' / '}
              {t('storageUsageAvgPrefix')}
              {' '}
              {(usage.drawings.pointCount / usage.drawings.strokeCount).toFixed(1)}
              {' '}
              {t('storageUsageUnitPoints')}
              {t('storageUsagePerStrokeSuffix')}
              {' / '}
              {t('storageUsageAvgPrefix')}
              {' '}
              {formatBytes(Math.round(usage.drawings.strokes / usage.drawings.strokeCount))}
              {t('storageUsagePerStrokeSuffix')}
              {usage.drawings.drawingCount > 0 && ` / ${t('storageUsageAvgPrefix')} ${(usage.drawings.strokeCount / usage.drawings.drawingCount).toFixed(1)} ${t('storageUsageUnitStrokes')}${t('storageUsagePerDrawingSuffix')}`}
            </Typography>
          )}
          {usage.urlHistoryImageBytes > 0 && (
            <Typography variant="caption" component="div">
              {t('storageUsageImageHistory')}
              {' '}
              {formatBytes(usage.urlHistoryImageBytes)}
            </Typography>
          )}
          {usage.estimateUsage != null && (
            <Typography variant="caption" component="div">
              {t('storageUsageTotal')}
              {' '}
              {formatBytes(usage.estimateUsage)}
              {usage.estimateQuota != null && ` / ${formatBytes(usage.estimateQuota)}`}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

const cardDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface DrawingCardProps {
  drawing: DrawingRecord;
  showReferenceLabel: boolean;
  showReferenceButton: boolean;
  referenceThumbUrl: string | null;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onLoadReference: (drawing: DrawingRecord) => void;
}

function DrawingCard({
  drawing,
  showReferenceLabel,
  showReferenceButton,
  referenceThumbUrl,
  selected,
  onToggleSelect,
  onLoadReference,
}: DrawingCardProps) {
  const refLabel = showReferenceLabel
    ? refLabelOf(drawing.reference, drawing.referenceInfo || '')
    : '';
  const drawingId = drawing.id;
  return (
    <Box
      sx={{
        'border': '1px solid #ddd',
        'borderRadius': 1,
        'overflow': 'hidden',
        'position': 'relative',
        'outline': selected ? '2px solid' : 'none',
        'outlineColor': 'primary.main',
        'outlineOffset': '-2px',
        '&:hover': { borderColor: 'primary.main' },
      }}
    >
      {drawing.thumbnail && (
        <img
          src={drawing.thumbnail}
          alt={`#${drawingId}`}
          style={{ width: '100%', height: 140, objectFit: 'contain', background: '#fafafa' }}
        />
      )}
      {drawingId != null && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            bgcolor: 'rgba(255,255,255,0.85)',
            borderRadius: '50%',
            lineHeight: 0,
          }}
        >
          <Checkbox
            size="small"
            checked={selected}
            onChange={() => onToggleSelect(drawingId)}
            slotProps={{ input: { 'aria-label': selected ? t('deselectDrawing') : t('selectDrawing') } }}
          />
        </Box>
      )}
      <Box sx={{ p: 1 }}>
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          {cardDateFormatter.format(new Date(drawing.createdAt))}
          {' '}
          /
          {formatTime(drawing.elapsedMs)}
        </Typography>
        {refLabel && (
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {refLabel}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
          {showReferenceButton && (
            <>
              {referenceThumbUrl
                ? (
                    <img
                      src={referenceThumbUrl}
                      alt={t('referenceThumbnailAlt')}
                      style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 2, flexShrink: 0, background: '#fafafa' }}
                    />
                  )
                : (
                    <Box sx={{ width: 24, height: 24, borderRadius: 0.5, bgcolor: '#eee', flexShrink: 0 }} />
                  )}
              <Button
                size="small"
                variant="outlined"
                onClick={() => onLoadReference(drawing)}
                sx={{ fontSize: '0.65rem', py: 0, minHeight: 24 }}
              >
                {t('loadReference')}
              </Button>
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <ExportMenuButton drawing={drawing} />
        </Box>
      </Box>
    </Box>
  );
}

function ExportMenuButton({ drawing }: { drawing: DrawingRecord }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const handleExport = async (format: ExportFormat) => {
    setAnchorEl(null);
    try {
      await exportDrawing(drawing, format);
    }
    catch (err) {
      console.error('Failed to export drawing', err);
      alert(t('exportFailed'));
    }
  };

  return (
    <>
      <ToolbarTooltip title={t('exportDrawing')}>
        <span>
          <IconButton
            size="small"
            onClick={e => setAnchorEl(e.currentTarget)}
            disabled={drawing.strokes.length === 0}
          >
            <Download size={20} />
          </IconButton>
        </span>
      </ToolbarTooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => handleExport('svg')}>SVG</MenuItem>
        <MenuItem onClick={() => handleExport('png')}>PNG</MenuItem>
        <MenuItem onClick={() => handleExport('jpeg')}>JPEG</MenuItem>
      </Menu>
    </>
  );
}
