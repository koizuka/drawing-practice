import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Box, Typography, IconButton, Tooltip, Button, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { X, Trash2 } from 'lucide-react'
import { getAllDrawings, deleteDrawing, type DrawingRecord } from '../storage'
import { getUrlHistoryEntry } from '../storage/urlHistoryStore'
import { formatTime } from '../hooks/useTimer'
import { t } from '../i18n'
import { referenceKey, type ReferenceInfo } from '../types'

type GroupMode = 'date' | 'ref-first' | 'ref-recent'
const STORAGE_KEY = 'gallery.groupMode'
const LEGACY_GROUP_KEY = '__legacy__'

function loadGroupMode(): GroupMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'date' || v === 'ref-first' || v === 'ref-recent') return v
  } catch { /* ignore */ }
  return 'date'
}

function persistGroupMode(mode: GroupMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' })
const dayFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })

function refLabelOf(ref: ReferenceInfo | undefined, fallback: string): string {
  if (!ref) return fallback
  const parts = [ref.title]
  if (ref.author) parts.push(ref.author)
  const joined = parts.join(' - ')
  return joined || fallback
}

function canLoadReference(ref: ReferenceInfo | undefined): boolean {
  if (!ref) return false
  if (ref.source === 'sketchfab' && ref.sketchfabUid) return true
  if (ref.source === 'url' && ref.imageUrl) return true
  if (ref.source === 'youtube' && ref.youtubeVideoId) return true
  if (ref.source === 'pexels' && ref.pexelsImageUrl) return true
  // Local images are reloadable as long as the drawing has a history key
  // recorded. The actual availability of the Blob in URL history is checked
  // lazily at load time (the entry may have been evicted by the 10-cap, in
  // which case SplitLayout surfaces the error).
  if (ref.source === 'image' && ref.url) return true
  return false
}

/**
 * Sync thumbnail URL for non-image references. Image references resolve
 * asynchronously via the imageThumbs cache populated from urlHistory blobs.
 */
function syncThumbUrl(ref: ReferenceInfo): string | null {
  switch (ref.source) {
    case 'sketchfab': return ref.imageUrl ?? null
    case 'url': return ref.imageUrl
    case 'youtube': return `https://i.ytimg.com/vi/${ref.youtubeVideoId}/default.jpg`
    case 'pexels': return ref.pexelsImageUrl
    case 'image': return null
  }
}

interface Group {
  key: string
  label: string
  reference?: ReferenceInfo
  firstUsedAt: Date
  lastUsedAt: Date
  drawings: DrawingRecord[]
}

function buildGroups(drawings: DrawingRecord[], mode: GroupMode): Group[] {
  if (drawings.length === 0) return []
  const buckets = new Map<string, Group>()

  for (const d of drawings) {
    const date = new Date(d.createdAt)
    let key: string
    let label: string
    let reference: ReferenceInfo | undefined

    if (mode === 'date') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      label = monthFormatter.format(date)
    } else {
      const ref = d.reference
      reference = ref
      if (ref) {
        key = referenceKey(ref)
        label = refLabelOf(ref, t('ungroupedReferences'))
      } else {
        key = LEGACY_GROUP_KEY
        label = t('ungroupedReferences')
      }
    }

    let g = buckets.get(key)
    if (!g) {
      g = { key, label, reference, firstUsedAt: date, lastUsedAt: date, drawings: [] }
      buckets.set(key, g)
    }
    g.drawings.push(d)
    if (date < g.firstUsedAt) g.firstUsedAt = date
    if (date > g.lastUsedAt) g.lastUsedAt = date
  }

  const groups = Array.from(buckets.values())
  for (const g of groups) {
    g.drawings.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  }
  if (mode === 'date') {
    groups.sort((a, b) => b.key.localeCompare(a.key))
  } else if (mode === 'ref-first') {
    groups.sort((a, b) => +b.firstUsedAt - +a.firstUsedAt)
  } else {
    groups.sort((a, b) => +b.lastUsedAt - +a.lastUsedAt)
  }
  return groups
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
  const enqueuedKeysRef = useRef<Set<string>>(new Set())
  const objectUrlsRef = useRef<string[]>([])

  const setGroupMode = useCallback((mode: GroupMode) => {
    setGroupModeState(mode)
    persistGroupMode(mode)
  }, [])

  useEffect(() => {
    let cancelled = false
    getAllDrawings().then(all => {
      if (!cancelled) {
        setDrawings(all)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  // Resolve image-source reference thumbnails by reading the Blob from URL
  // history. Each unique referenceKey is fetched at most once; results are
  // cached for the lifetime of the gallery view.
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
    setDrawings(prev => prev.filter(d => d.id !== id))
  }, [])

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

  const groups = useMemo(() => buildGroups(drawings, groupMode), [drawings, groupMode])

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
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: '1px solid #ddd',
          flexWrap: 'wrap',
        }}>
          <Typography variant="h6" sx={{ flex: 1, minWidth: 120 }}>
            {t('galleryTitle')} ({drawings.length})
          </Typography>
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
          <IconButton onClick={onClose} size="small">
            <X size={20} />
          </IconButton>
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
            const groupDateLabel = isRefMode
              ? (groupMode === 'ref-first'
                  ? `${t('groupLabelFirstUsed')}: ${dayFormatter.format(group.firstUsedAt)}`
                  : `${t('groupLabelRecentUsed')}: ${dayFormatter.format(group.lastUsedAt)}`)
              : null

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
