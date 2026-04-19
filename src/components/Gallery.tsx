import { useState, useEffect, useCallback } from 'react'
import { Box, Typography, IconButton, Tooltip, Button } from '@mui/material'
import { X, Trash2 } from 'lucide-react'
import { getAllDrawings, deleteDrawing, type DrawingRecord } from '../storage'
import { formatTime } from '../hooks/useTimer'
import { t } from '../i18n'
import type { ReferenceInfo } from './SketchfabViewer'

interface GalleryProps {
  onClose: () => void
  onLoadReference?: (info: ReferenceInfo) => void
}

export function Gallery({ onClose, onLoadReference }: GalleryProps) {
  const [drawings, setDrawings] = useState<DrawingRecord[]>([])
  const [loading, setLoading] = useState(true)

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

  const handleDelete = useCallback(async (id: number) => {
    await deleteDrawing(id)
    setDrawings(prev => prev.filter(d => d.id !== id))
  }, [])

  const handleLoadReference = useCallback((drawing: DrawingRecord) => {
    const ref = drawing.reference
    if (!ref) return
    onLoadReference?.(ref)
    onClose()
  }, [onLoadReference, onClose])

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getRefLabel = (drawing: DrawingRecord): string => {
    if (drawing.reference) {
      const parts = [drawing.reference.title]
      if (drawing.reference.author) parts.push(drawing.reference.author)
      return parts.join(' - ')
    }
    return drawing.referenceInfo || ''
  }

  const canLoadReference = (drawing: DrawingRecord): boolean => {
    if (!drawing.reference) return false
    if (drawing.reference.source === 'sketchfab' && drawing.reference.sketchfabUid) return true
    if (drawing.reference.source === 'url' && drawing.reference.imageUrl) return true
    if (drawing.reference.source === 'youtube' && drawing.reference.youtubeVideoId) return true
    if (drawing.reference.source === 'pexels' && drawing.reference.pexelsImageUrl) return true
    return false
  }

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
          px: 2,
          py: 1.5,
          borderBottom: '1px solid #ddd',
        }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {t('galleryTitle')} ({drawings.length})
          </Typography>
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

          {!loading && drawings.length > 0 && (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 2,
            }}>
              {drawings.map(drawing => {
                const refLabel = getRefLabel(drawing)
                return (
                  <Box
                    key={drawing.id}
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
                        {formatDate(drawing.createdAt)} / {formatTime(drawing.elapsedMs)}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
                        {canLoadReference(drawing) && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleLoadReference(drawing)}
                            sx={{ fontSize: '0.65rem', py: 0, minHeight: 24 }}
                          >
                            {t('loadReference')}
                          </Button>
                        )}
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title={t('delete')}>
                          <IconButton
                            size="small"
                            onClick={() => drawing.id != null && handleDelete(drawing.id)}
                          >
                            <Trash2 size={20} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
