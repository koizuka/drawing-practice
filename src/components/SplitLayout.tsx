import { useState, useCallback, useRef, useEffect } from 'react'
import { Box } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { GuideProvider } from '../guides/GuideContext'
import { ReferencePanel } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import { StrokeManager } from '../drawing/StrokeManager'
import type { Stroke } from '../drawing/types'

export function SplitLayout() {
  const orientation = useOrientation()
  const isLandscape = orientation === 'landscape'
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null)
  const [overlayActive, setOverlayActive] = useState(false)
  const [referenceSize, setReferenceSize] = useState<{ width: number; height: number } | null>(null)
  const strokeManagerRef = useRef<StrokeManager | null>(null)

  const handleReferenceImageSize = useCallback((width: number, height: number) => {
    setReferenceSize({ width, height })
  }, [])

  const handleToggleOverlay = useCallback(() => {
    setOverlayActive(prev => {
      const next = !prev
      if (next && strokeManagerRef.current) {
        setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
      } else {
        setOverlayStrokes(null)
      }
      return next
    })
  }, [])

  const handleStrokeManagerReady = useCallback((sm: StrokeManager) => {
    strokeManagerRef.current = sm
  }, [])

  // Sync overlay when strokes change (called by DrawingPanel)
  const handleStrokesChanged = useCallback(() => {
    if (overlayActive && strokeManagerRef.current) {
      setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
    }
  }, [overlayActive])

  // Clear overlay when drawing is cleared
  useEffect(() => {
    if (overlayActive && overlayStrokes && overlayStrokes.length === 0) {
      // Keep overlay active even with no strokes (live mode)
    }
  }, [overlayActive, overlayStrokes])

  return (
    <GuideProvider>
      <Box
        sx={{
          display: 'flex',
          flexDirection: isLandscape ? 'row' : 'column',
          width: '100vw',
          height: '100dvh',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <ReferencePanel
            overlayStrokes={overlayStrokes}
            onReferenceImageSize={handleReferenceImageSize}
            overlayActive={overlayActive}
            onToggleOverlay={handleToggleOverlay}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <DrawingPanel
            referenceSize={referenceSize}
            onStrokeManagerReady={handleStrokeManagerReady}
            onStrokesChanged={handleStrokesChanged}
            onOverlayClear={() => { setOverlayActive(false); setOverlayStrokes(null) }}
          />
        </Box>
      </Box>
    </GuideProvider>
  )
}
