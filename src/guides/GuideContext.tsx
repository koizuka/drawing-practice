import { createContext, useRef, useState, useCallback, type ReactNode } from 'react';
import { GuideManager } from './GuideManager';
import type { GuideLine, GridSettings, GridMode, GuideState, PerspectiveSettings } from './types';
import { DEFAULT_GUIDE_STATE } from './types';

interface GuideContextValue {
  guideManagerRef: React.RefObject<GuideManager>;
  grid: GridSettings;
  lines: readonly GuideLine[];
  version: number;
  /** True when the last change was mid-gesture (drag); autosave may debounce it. */
  lastChangeTransient: boolean;
  setGridMode: (mode: GridMode) => void;
  setPerspective: (patch: Partial<PerspectiveSettings>, opts?: { transient?: boolean }) => void;
  /** Non-persisted UI state: next tap on a panel places the perspective anchor. */
  placingCenter: boolean;
  setPlacingCenter: (placing: boolean) => void;
  placePerspectiveCenter: (x: number, y: number) => void;
  addLine: (x1: number, y1: number, x2: number, y2: number) => GuideLine;
  removeLine: (id: string) => void;
  clearLines: () => void;
  restoreGuides: (state: GuideState) => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

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

export { GuideContext };
export type { GuideContextValue };
