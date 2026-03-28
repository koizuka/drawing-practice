import { createContext, useRef, useState, useCallback, type ReactNode } from 'react'
import { GuideManager } from './GuideManager'
import type { GuideLine, GridSettings } from './types'
import { DEFAULT_GUIDE_STATE } from './types'

interface GuideContextValue {
  guideManagerRef: React.RefObject<GuideManager>
  grid: GridSettings
  lines: readonly GuideLine[]
  version: number
  toggleGrid: () => void
  setGridSpacing: (spacing: number) => void
  addLine: (x1: number, y1: number, x2: number, y2: number) => GuideLine
  removeLine: (id: string) => void
  clearLines: () => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

export function GuideProvider({ children }: { children: ReactNode }) {
  const guideManagerRef = useRef(new GuideManager())
  const [version, setVersion] = useState(0)
  const [grid, setGrid] = useState<GridSettings>(DEFAULT_GUIDE_STATE.grid)
  const [lines, setLines] = useState<readonly GuideLine[]>([])

  const sync = useCallback(() => {
    setVersion(v => v + 1)
    setGrid(guideManagerRef.current.getGrid())
    setLines([...guideManagerRef.current.getLines()])
  }, [])

  const toggleGrid = useCallback(() => {
    const gm = guideManagerRef.current
    gm.setGridEnabled(!gm.getGrid().enabled)
    sync()
  }, [sync])

  const setGridSpacing = useCallback((spacing: number) => {
    guideManagerRef.current.setGridSpacing(spacing)
    sync()
  }, [sync])

  const addLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const line = guideManagerRef.current.addLine(x1, y1, x2, y2)
    sync()
    return line
  }, [sync])

  const removeLine = useCallback((id: string) => {
    guideManagerRef.current.removeLine(id)
    sync()
  }, [sync])

  const clearLines = useCallback(() => {
    guideManagerRef.current.clearLines()
    sync()
  }, [sync])

  return (
    <GuideContext.Provider value={{
      guideManagerRef,
      grid,
      lines,
      version,
      toggleGrid,
      setGridSpacing,
      addLine,
      removeLine,
      clearLines,
    }}>
      {children}
    </GuideContext.Provider>
  )
}

export { GuideContext }
export type { GuideContextValue }
