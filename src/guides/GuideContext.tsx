import { useRef, useState, useCallback, type ReactNode } from 'react';
import { GuideManager } from './GuideManager';
import type { GuideLine, GridSettings, GridMode, GuideState, PerspectiveSettings } from './types';
import { DEFAULT_GUIDE_STATE } from './types';
import { GuideContext } from './guideContextValue';

export function GuideProvider({ children }: { children: ReactNode }) {
  const guideManagerRef = useRef(new GuideManager());
  const [version, setVersion] = useState(0);
  const [grid, setGrid] = useState<GridSettings>(DEFAULT_GUIDE_STATE.grid);
  const [lines, setLines] = useState<readonly GuideLine[]>([]);
  const [lastChangeTransient, setLastChangeTransient] = useState(false);
  const [placingCenter, setPlacingCenter] = useState(false);

  const sync = useCallback((transient = false) => {
    setVersion(v => v + 1);
    setGrid(guideManagerRef.current.getGrid());
    setLines([...guideManagerRef.current.getLines()]);
    setLastChangeTransient(transient);
  }, []);

  const setGridMode = useCallback((mode: GridMode) => {
    guideManagerRef.current.setGridMode(mode);
    // Disarm the place-anchor mode when leaving perspective — otherwise the
    // next tap would still mutate the (now hidden) perspective settings.
    if (mode !== 'perspective') setPlacingCenter(false);
    sync();
  }, [sync]);

  const setPerspective = useCallback((patch: Partial<PerspectiveSettings>, opts?: { transient?: boolean }) => {
    guideManagerRef.current.setPerspective(patch);
    sync(opts?.transient ?? false);
  }, [sync]);

  const recordPerspectiveMemory = useCallback(() => {
    // Transient sync: capture rides along a freehand stroke commit, so it takes
    // the same 2s-debounce autosave path as the stroke instead of an immediate
    // flush per stroke.
    if (guideManagerRef.current.recordPerspectiveMemory()) sync(true);
  }, [sync]);

  const removePerspectiveMemory = useCallback((seq: number) => {
    // Discrete button action — non-transient sync so autosave flushes at once.
    if (guideManagerRef.current.removePerspectiveMemory(seq)) sync();
  }, [sync]);

  const placePerspectiveCenter = useCallback((x: number, y: number) => {
    guideManagerRef.current.setPerspective({ centerX: x, centerY: y });
    setPlacingCenter(false);
    sync();
  }, [sync]);

  const addLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const line = guideManagerRef.current.addLine(x1, y1, x2, y2);
    sync();
    return line;
  }, [sync]);

  const removeLine = useCallback((id: string) => {
    guideManagerRef.current.removeLine(id);
    sync();
  }, [sync]);

  const clearLines = useCallback(() => {
    guideManagerRef.current.clearLines();
    sync();
  }, [sync]);

  const restoreGuides = useCallback((state: GuideState) => {
    guideManagerRef.current.importState(state);
    sync();
  }, [sync]);

  return (
    <GuideContext.Provider value={{
      guideManagerRef,
      grid,
      lines,
      version,
      lastChangeTransient,
      setGridMode,
      setPerspective,
      recordPerspectiveMemory,
      removePerspectiveMemory,
      placingCenter,
      setPlacingCenter,
      placePerspectiveCenter,
      addLine,
      removeLine,
      clearLines,
      restoreGuides,
    }}
    >
      {children}
    </GuideContext.Provider>
  );
}
