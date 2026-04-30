import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Page-zoom defenses for areas that don't host self-rolled pinch:
// - iOS Safari: two-finger pinch fires `gesturestart`/`gesturechange`/`gestureend`
//   independently of `touch-action: none` and slips through on toolbars / search UI.
// - Trackpad / Ctrl+wheel: browsers report pinch as `wheel` with `ctrlKey: true`.
// Self-rolled pinch (ImageViewer, YouTubeViewer, DrawingCanvas) keeps working —
// it's built on TouchEvents plus per-canvas `wheel` listeners that still fire here.
const preventGesture = (e: Event) => e.preventDefault()
document.addEventListener('gesturestart', preventGesture)
document.addEventListener('gesturechange', preventGesture)
document.addEventListener('gestureend', preventGesture)
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault()
}, { passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
