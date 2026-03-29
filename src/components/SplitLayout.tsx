import { useState, useCallback, useRef } from 'react'
import { Box } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { GuideProvider } from '../guides/GuideContext'
import { ReferencePanel } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import { StrokeManager } from '../drawing/StrokeManager'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from './SketchfabViewer'

export function SplitLayout() {
  const orientation = useOrientation()
  const isLandscape = orientation === 'landscape'
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null)
  const [overlayActive, setOverlayActive] = useState(false)
  const [referenceSize, setReferenceSize] = useState<{ width: number; height: number } | null>(null)
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo | null>(null)
  const strokeManagerRef = useRef<StrokeManager | null>(null)
  const loadReferenceFnRef = useRef<((info: ReferenceInfo) => void) | null>(null)

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

  const handleStrokesChanged = useCallback(() => {
    if (overlayActive && strokeManagerRef.current) {
      setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
    }
  }, [overlayActive])

  const handleRegisterLoadReference = useCallback((loadFn: (info: ReferenceInfo) => void) => {
    loadReferenceFnRef.current = loadFn
  }, [])

  const handleLoadReference = useCallback((info: ReferenceInfo) => {
    loadReferenceFnRef.current?.(info)
  }, [])

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
            onReferenceInfoChange={setReferenceInfo}
            onRegisterLoadReference={handleRegisterLoadReference}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <DrawingPanel
            referenceSize={referenceSize}
            referenceInfo={referenceInfo}
            onStrokeManagerReady={handleStrokeManagerReady}
            onStrokesChanged={handleStrokesChanged}
            onOverlayClear={() => { setOverlayActive(false); setOverlayStrokes(null) }}
            onLoadReference={handleLoadReference}
          />
        </Box>
      </Box>
    </GuideProvider>
  )
}
