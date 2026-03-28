import { useState, useCallback } from 'react'
import { Box } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { GuideProvider } from '../guides/GuideContext'
import { ReferencePanel } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import type { Stroke } from '../drawing/types'

export function SplitLayout() {
  const orientation = useOrientation()
  const isLandscape = orientation === 'landscape'
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null)
  const [referenceSize, setReferenceSize] = useState<{ width: number; height: number } | null>(null)

  const handleOverlayStrokes = useCallback((strokes: readonly Stroke[] | null) => {
    setOverlayStrokes(strokes)
  }, [])

  const handleReferenceImageSize = useCallback((width: number, height: number) => {
    setReferenceSize({ width, height })
  }, [])

  return (
    <GuideProvider>
      <Box
        sx={{
          display: 'flex',
          flexDirection: isLandscape ? 'row' : 'column',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <ReferencePanel overlayStrokes={overlayStrokes} onReferenceImageSize={handleReferenceImageSize} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <DrawingPanel onOverlayStrokes={handleOverlayStrokes} referenceSize={referenceSize} />
        </Box>
      </Box>
    </GuideProvider>
  )
}
