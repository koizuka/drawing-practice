import { createContext } from 'react';
import type { GuideManager } from './GuideManager';
import type { GuideLine, GridSettings, GridMode, GuideState, PerspectiveSettings } from './types';

export interface GuideContextValue {
  guideManagerRef: React.RefObject<GuideManager>;
  grid: GridSettings;
  lines: readonly GuideLine[];
  version: number;
  /** True when the last change was mid-gesture (drag); autosave may debounce it. */
  lastChangeTransient: boolean;
  setGridMode: (mode: GridMode) => void;
  setPerspective: (patch: Partial<PerspectiveSettings>, opts?: { transient?: boolean }) => void;
  /** Snapshot the current perspective settings into the recall-memory list (no-op if already memorized). */
  recordPerspectiveMemory: () => void;
  /** Delete one perspective memory by its label number. */
  removePerspectiveMemory: (seq: number) => void;
  /** Non-persisted UI state: next tap on a panel places the perspective anchor. */
  placingCenter: boolean;
  setPlacingCenter: (placing: boolean) => void;
  placePerspectiveCenter: (x: number, y: number) => void;
  addLine: (x1: number, y1: number, x2: number, y2: number) => GuideLine;
  removeLine: (id: string) => void;
  clearLines: () => void;
  restoreGuides: (state: GuideState) => void;
}

// Kept out of GuideContext.tsx so that file exports only the GuideProvider
// component (react-refresh/only-export-components).
export const GuideContext = createContext<GuideContextValue | null>(null);
