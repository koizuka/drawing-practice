import { useState, useEffect, useCallback } from 'react'
import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import { getAllDrawings, deleteDrawing, type DrawingRecord } from '../storage'
import { formatTime } from '../hooks/useTimer'

interface GalleryProps {
  onClose: () => void
}

export function Gallery({ onClose }: GalleryProps) {
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

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
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
            Gallery ({drawings.length})
          </Typography>
          <IconButton onClick={onClose} size="small">
            &#10005;
          </IconButton>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {loading && (
            <Typography color="text.secondary">Loading...</Typography>
          )}

          {!loading && drawings.length === 0 && (
            <Typography color="text.secondary">No saved drawings yet.</Typography>
          )}

          {!loading && drawings.length > 0 && (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 2,
            }}>
              {drawings.map(drawing => (
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
                      alt={`Drawing ${drawing.id}`}
                      style={{ width: '100%', height: 140, objectFit: 'contain', background: '#fafafa' }}
                    />
                  )}
                  <Box sx={{ p: 1 }}>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                      {formatDate(drawing.createdAt)}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                      {formatTime(drawing.elapsedMs)}
                      {drawing.referenceInfo && ` - ${drawing.referenceInfo}`}
                    </Typography>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => drawing.id != null && handleDelete(drawing.id)}
                        sx={{ mt: 0.5 }}
                      >
                        &#128465;
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
