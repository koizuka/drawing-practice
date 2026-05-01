import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Block ctrl+wheel page-zoom (browsers report trackpad pinch as wheel+ctrlKey).
// Self-rolled pinch in ImageViewer/YouTubeViewer/DrawingCanvas works via their
// own per-canvas listeners. iOS touch pinch and Cmd +/- remain available.
// Touch devices only: search screens (Sketchfab/Pexels) opt back in via
// `data-allow-page-zoom="true"` so users can pinch small thumbnails;
// resetPageZoom() restores 1.0 on screen transition. macOS ctrl+wheel is the
// browser page-zoom (no JS reset API), so it stays blocked on desktop.
const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const preventCtrlWheelZoom = (e: WheelEvent) => {
  if (!e.ctrlKey) return
  if (isTouchDevice) {
    const target = e.target as Element | null
    if (target?.closest('[data-allow-page-zoom="true"]')) return
  }
  e.preventDefault()
}
document.addEventListener('wheel', preventCtrlWheelZoom, { passive: false })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener('wheel', preventCtrlWheelZoom)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
