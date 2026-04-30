import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Block trackpad / Ctrl+wheel page zoom. Browsers report trackpad pinch as
// `wheel` with `ctrlKey: true`; otherwise the chrome and reference selection
// screens silently page-zoom while the user means to pinch the canvas.
// Self-rolled pinch (ImageViewer, YouTubeViewer, DrawingCanvas) keeps working —
// each registers its own per-canvas `wheel` listener that still fires here.
// iOS touch pinch and browser zoom (Cmd +/-, accessibility zoom) are intentionally
// left available — viewport meta no longer locks scale, so users who need to zoom
// can still do so.
const preventCtrlWheelZoom = (e: WheelEvent) => {
  if (e.ctrlKey) e.preventDefault()
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
