import { useState, useCallback } from 'react'
import { Box, Button, Tooltip, IconButton } from '@mui/material'
import { SketchfabViewer } from './SketchfabViewer'
import { ImageViewer } from './ImageViewer'
import { useGuides } from '../guides/useGuides'
import type { Stroke } from '../drawing/types'

type ReferenceSource = 'none' | 'sketchfab' | 'image'
type ReferenceMode = 'browse' | 'fixed'

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  onReferenceImageSize?: (width: number, height: number) => void
}

export function ReferencePanel({ overlayStrokes, onReferenceImageSize }: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, toggleGrid } = useGuides()
  const [source, setSource] = useState<ReferenceSource>('none')
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse')
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null)
  const [viewResetVersion, setViewResetVersion] = useState(0)

  const handleLoadLocalImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const url = URL.createObjectURL(file)
      setLocalImageUrl(url)
      setSource('image')
      setReferenceMode('fixed')
    }
    input.click()
  }, [])

  const handleFixAngle = useCallback((screenshotUrl: string) => {
    setFixedImageUrl(screenshotUrl)
    setReferenceMode('fixed')
  }, [])

  const handleChangeAngle = useCallback(() => {
    setReferenceMode('browse')
    setFixedImageUrl(null)
  }, [])

  const handleOpenSketchfab = useCallback(() => {
    setSource('sketchfab')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setLocalImageUrl(null)
  }, [])

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid #ddd',
          bgcolor: '#fafafa',
          flexWrap: 'wrap',
          minHeight: 40,
        }}
      >
        <Button size="small" variant={source === 'sketchfab' ? 'contained' : 'outlined'} onClick={handleOpenSketchfab}>
          Sketchfab
        </Button>
        <Button size="small" variant={source === 'image' ? 'contained' : 'outlined'} onClick={handleLoadLocalImage}>
          Image
        </Button>

        {source === 'sketchfab' && referenceMode === 'fixed' && (
          <>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" onClick={handleChangeAngle}>
              Change Angle
            </Button>
          </>
        )}

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        <Tooltip title="Toggle grid">
          <IconButton
            size="small"
            onClick={toggleGrid}
            sx={{
              bgcolor: grid.enabled ? 'info.main' : 'transparent',
              color: grid.enabled ? 'white' : 'inherit',
              '&:hover': { bgcolor: grid.enabled ? 'info.dark' : 'action.hover' },
            }}
          >
            #
          </IconButton>
        </Tooltip>

        {(referenceMode === 'fixed' && displayImageUrl) && (
          <Tooltip title="Reset zoom">
            <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
              &#8858;
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {source === 'none' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
            Select a reference source above
          </Box>
        )}

        {source === 'sketchfab' && referenceMode === 'browse' && (
          <SketchfabViewer onFixAngle={handleFixAngle} />
        )}

        {referenceMode === 'fixed' && displayImageUrl && (
          <ImageViewer
            imageUrl={displayImageUrl}
            viewResetVersion={viewResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            onImageLoaded={onReferenceImageSize}
          />
        )}
      </Box>
    </Box>
  )
}
