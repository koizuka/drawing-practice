import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Block trackpad / Ctrl+wheel page zoom on UI chrome. Browsers report trackpad
// pinch as `wheel` with `ctrlKey: true`, and viewport meta cannot constrain it.
// iOS touch pinch is handled declaratively by the viewport meta `maximum-scale=1.0`.
// Self-rolled pinch (ImageViewer, YouTubeViewer, DrawingCanvas) keeps working —
// each registers its own per-canvas `wheel` listener that still fires here.
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault()
}, { passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
