import { useEffect, useRef, useCallback } from 'react';
import { saveDraft, clearDraft } from '../storage/sessionStore';
import type { DraftData } from '../storage/sessionStore';
import type { Stroke } from '../drawing/types';
import type { ReferenceInfo, ReferenceSource } from '../types';
import type { GridSettings, GuideLine } from '../guides/types';

const DEBOUNCE_MS = 2000;

interface AutosaveState {
  strokes: readonly Stroke[];
  redoStack: readonly Stroke[];
  elapsedMs: number;
  source: ReferenceSource;
  referenceInfo: ReferenceInfo | null;
  referenceImageData: string | null;
  grid: GridSettings;
  lines: readonly GuideLine[];
  referenceCollapsed?: boolean;
}

export function useAutosave(
  getState: () => AutosaveState,
  changeVersion: number,
  flushVersion: number,
  suppressRef: React.RefObject<boolean>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getStateRef = useRef(getState);
  useEffect(() => {
    getStateRef.current = getState;
  }, [getState]);

  const doSave = useCallback(async () => {
    if (suppressRef.current) return;

    const state = getStateRef.current();
    const hasStrokes = state.strokes.length > 0;
    const hasReference = state.source !== 'none';

    // Persist a draft if the user has any in-progress signal — strokes, an
    // active reference, or a non-default layout (collapsed = free-drawing mode
    // they want to keep across reloads even with no strokes yet).
    if (!hasStrokes && !hasReference && !state.referenceCollapsed) {
      await clearDraft();
      return;
    }

    const data: DraftData = {
      strokes: [...state.strokes],
      redoStack: [...state.redoStack],
      elapsedMs: state.elapsedMs,
      source: state.source,
      referenceInfo: state.referenceInfo,
      referenceImageData: state.referenceImageData,
      guideState: {
        grid: { ...state.grid },
        lines: [...state.lines],
      },
      referenceCollapsed: state.referenceCollapsed ?? false,
    };

    await saveDraft(data);
  }, [suppressRef]);

  useEffect(() => {
    if (changeVersion === 0) return; // Skip initial render

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      doSave();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [changeVersion, doSave]);

  // Immediate-save path. Reference changes bump flushVersion so saveDraft fires
  // immediately (without waiting for the 2s debounce). The IndexedDB write
  // itself is async, but the call is queued right away — otherwise a quick
  // reload after a reference swap would restore the previous reference.
  useEffect(() => {
    if (flushVersion === 0) return; // Skip initial render

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    doSave();
  }, [flushVersion, doSave]);
}
