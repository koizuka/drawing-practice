import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Box, Typography, IconButton, Tooltip, Button, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { X, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getAllDrawings,
  deleteDrawing,
  computeStorageUsage,
  formatBytes,
  type DrawingRecord,
  type StorageUsage,
} from '../storage'
import { getUrlHistoryEntry } from '../storage/urlHistoryStore'
import { formatTime } from '../hooks/useTimer'
import { t } from '../i18n'
import { referenceKey, type ReferenceInfo } from '../types'
import {
  buildGroups,
  canLoadReference,
  loadGroupMode,
  persistGroupMode,
  refLabelOf,
  syncThumbUrl,
  type GroupMode,
} from './galleryGrouping'

const dayFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })

function formatGroupDateLabel(
  mode: GroupMode,
  firstUsedAt: Date,
  lastUsedAt: Date,
): string | null {
  if (mode === 'ref-first') return `${t('groupLabelFirstUsed')}: ${dayFormatter.format(firstUsedAt)}`
  if (mode === 'ref-recent') return `${t('groupLabelRecentUsed')}: ${dayFormatter.format(lastUsedAt)}`
  return null
}

interface GalleryProps {
  onClose: () => void
  onLoadReference?: (info: ReferenceInfo) => void
}

export function Gallery({ onClose, onLoadReference }: GalleryProps) {
  const [drawings, setDrawings] = useState<DrawingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [groupMode, setGroupModeState] = useState<GroupMode>(loadGroupMode)
  const [imageThumbs, setImageThumbs] = useState<Record<string, string | null>>({})
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const enqueuedKeysRef = useRef<Set<string>>(new Set())
  const objectUrlsRef = useRef<string[]>([])

  const setGroupMode = useCallback((mode: GroupMode) => {
    setGroupModeState(mode)
    persistGroupMode(mode)
  }, [])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    getAllDrawings().then(all => {
      if (cancelled) return
      setDrawings(all)
      setLoading(false)
      computeStorageUsage(all).then(u => {
        if (!cancelled) setUsage(u)
      }).catch(() => { /* ignore */ })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tasks: Array<{ key: string; historyKey: string }> = []
    for (const d of drawings) {
      const ref = d.reference
      if (!ref || ref.source !== 'image' || !ref.url) continue
      const key = referenceKey(ref)
      if (enqueuedKeysRef.current.has(key)) continue
      enqueuedKeysRef.current.add(key)
      tasks.push({ key, historyKey: ref.url })
    }
    for (const task of tasks) {
      getUrlHistoryEntry(task.historyKey).then(entry => {
        if (cancelled) return
        if (entry?.imageBlob) {
          const url = URL.createObjectURL(entry.imageBlob)
          objectUrlsRef.current.push(url)
          setImageThumbs(prev => ({ ...prev, [task.key]: url }))
        } else {
          setImageThumbs(prev => ({ ...prev, [task.key]: null }))
        }
      }).catch(() => {
        if (cancelled) return
        setImageThumbs(prev => ({ ...prev, [task.key]: null }))
      })
    }
    return () => { cancelled = true }
  }, [drawings])

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
      objectUrlsRef.current = []
    }
  }, [])

  const handleDelete = useCallback(async (id: number) => {
    await deleteDrawing(id)
    const next = drawings.filter(d => d.id !== id)
    setDrawings(next)
    computeStorageUsage(next).then(u => {
      if (mountedRef.current) setUsage(u)
    }).catch(() => { /* ignore */ })
  }, [drawings])

  const handleLoadDrawingReference = useCallback((drawing: DrawingRecord) => {
    const ref = drawing.reference
    if (!ref) return
    onLoadReference?.(ref)
    onClose()
  }, [onLoadReference, onClose])

  const handleLoadGroupReference = useCallback((ref: ReferenceInfo | undefined) => {
    if (!ref) return
    onLoadReference?.(ref)
    onClose()
  }, [onLoadReference, onClose])

  const groups = useMemo(
    () => buildGroups(drawings, groupMode, t('ungroupedReferences')),
    [drawings, groupMode],
  )

  const getThumbForRef = useCallback((ref: ReferenceInfo | undefined): string | null => {
    if (!ref) return null
    if (ref.source === 'image') return imageThumbs[referenceKey(ref)] ?? null
    return syncThumbUrl(ref)
  }, [imageThumbs])

  const isRefMode = groupMode !== 'date'

  return (
    <Box sx={{
      position: 'fixed',
      inset: 0,
      bgcolor: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Box sx={{
        bgcolor: 'white',
        borderRadius: 2,
        width: '90vw',
        maxWidth: 900,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ borderBottom: '1px solid #ddd', px: 2, py: 1.5 }}>
          {/* Top row: title + close. Pinned together so the X stays at the
              top-right corner even on narrow screens where the toggle row
              below has to wrap. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }}>
              {t('galleryTitle')} ({drawings.length})
            </Typography>
            <IconButton onClick={onClose} size="small">
              <X size={20} />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', mt: 1, flexWrap: 'wrap', gap: 1 }}>
            <ToggleButtonGroup
              value={groupMode}
              exclusive
              size="small"
              onChange={(_e, val) => {
                if (val === null) return
                setGroupMode(val as GroupMode)
              }}
            >
              <ToggleButton value="date">{t('groupByDate')}</ToggleButton>
              <ToggleButton value="ref-first">{t('groupByRefFirst')}</ToggleButton>
              <ToggleButton value="ref-recent">{t('groupByRefRecent')}</ToggleButton>
            </ToggleButtonGroup>
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
            const groupThumb = isRefMode ? getThumbForRef(group.reference) : null
            const showGroupButton = isRefMode && canLoadReference(group.reference)
            const groupDateLabel = formatGroupDateLabel(groupMode, group.firstUsedAt, group.lastUsedAt)

            return (
              <Box
                key={group.key}
                sx={gi > 0 ? { borderTop: '1px solid #ddd', pt: 2, mt: 2 } : undefined}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {isRefMode && (
                    groupThumb ? (
                      <img
                        src={groupThumb}
                        alt={t('referenceThumbnailAlt')}
                        style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, background: '#fafafa', flexShrink: 0 }}
                      />
                    ) : (
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
                }}>
                  {group.drawings.map(drawing => (
                    <DrawingCard
                      key={drawing.id}
                      drawing={drawing}
                      showReferenceLabel={!isRefMode}
                      showReferenceButton={!isRefMode && canLoadReference(drawing.reference)}
                      referenceThumbUrl={!isRefMode ? getThumbForRef(drawing.reference) : null}
                      onDelete={handleDelete}
                      onLoadReference={handleLoadDrawingReference}
                    />
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

const STORAGE_USAGE_EXPANDED_KEY = 'gallery.storageUsageExpanded'

function loadStorageUsageExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_USAGE_EXPANDED_KEY) === '1'
  } catch { return false }
}

function persistStorageUsageExpanded(expanded: boolean): void {
  try { localStorage.setItem(STORAGE_USAGE_EXPANDED_KEY, expanded ? '1' : '0') } catch { /* ignore */ }
}

function StorageUsageRow({ usage }: { usage: StorageUsage }) {
  const [expanded, setExpanded] = useState<boolean>(loadStorageUsageExpanded)
  const toggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      persistStorageUsageExpanded(next)
      return next
    })
  }, [])

  const drawingsBytes = usage.drawings.strokes + usage.drawings.thumbnails + usage.drawings.sketchfabImages
  const totalLogical = drawingsBytes + usage.urlHistoryImageBytes + usage.sessionBytes
  const breakdownParts = [
    `${t('storageUsageStrokes')} ${formatBytes(usage.drawings.strokes)}`,
    `${t('storageUsageThumbnails')} ${formatBytes(usage.drawings.thumbnails)}`,
    `${t('storageUsageSketchfabImages')} ${formatBytes(usage.drawings.sketchfabImages)}`,
  ]

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
          {t('storageUsageTitle')}: {formatBytes(totalLogical)}
        </Typography>
      </Box>
      {expanded && (
        <Box sx={{ mt: 0.5, pl: 2 }}>
          <Typography variant="caption" component="div">
            {t('storageUsageDrawings')} {formatBytes(drawingsBytes)} ({breakdownParts.join(', ')})
          </Typography>
          {usage.urlHistoryImageBytes > 0 && (
            <Typography variant="caption" component="div">
              {t('storageUsageImageHistory')} {formatBytes(usage.urlHistoryImageBytes)}
            </Typography>
          )}
          {usage.estimateUsage != null && (
            <Typography variant="caption" component="div">
              {t('storageUsageTotal')} {formatBytes(usage.estimateUsage)}
              {usage.estimateQuota != null && ` / ${formatBytes(usage.estimateQuota)}`}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  )
}

const cardDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

interface DrawingCardProps {
  drawing: DrawingRecord
  showReferenceLabel: boolean
  showReferenceButton: boolean
  referenceThumbUrl: string | null
  onDelete: (id: number) => void
  onLoadReference: (drawing: DrawingRecord) => void
}

function DrawingCard({
  drawing,
  showReferenceLabel,
  showReferenceButton,
  referenceThumbUrl,
  onDelete,
  onLoadReference,
}: DrawingCardProps) {
  const refLabel = showReferenceLabel
    ? refLabelOf(drawing.reference, drawing.referenceInfo || '')
    : ''
  return (
    <Box
      sx={{
        border: '1px solid #ddd',
        borderRadius: 1,
        overflow: 'hidden',
        '&:hover': { borderColor: 'primary.main' },
      }}
    >
      {drawing.thumbnail && (
        <img
          src={drawing.thumbnail}
          alt={`#${drawing.id}`}
          style={{ width: '100%', height: 140, objectFit: 'contain', background: '#fafafa' }}
        />
      )}
      <Box sx={{ p: 1 }}>
        {refLabel && (
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {refLabel}
          </Typography>
        )}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          {cardDateFormatter.format(new Date(drawing.createdAt))} / {formatTime(drawing.elapsedMs)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
          {showReferenceButton && (
            <>
              {referenceThumbUrl ? (
                <img
                  src={referenceThumbUrl}
                  alt={t('referenceThumbnailAlt')}
                  style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 2, flexShrink: 0, background: '#fafafa' }}
                />
              ) : (
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
          <Tooltip title={t('delete')}>
            <IconButton
              size="small"
              onClick={() => drawing.id != null && onDelete(drawing.id)}
            >
              <Trash2 size={20} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )
}
