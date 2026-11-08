import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceSetters } from '../components/ReferencePanel';
import type { ReferenceSnapshot } from '../drawing/types';
import type { ReferenceInfo, ReferenceMode, ReferenceSource } from '../types';

/**
 * The five reference-state fields lifted into SplitLayout (source, mode,
 * fixed / local image URL, info), plus:
 *
 * - `setters` — the raw `ReferenceSetters` handed to `changeReference`
 *   mutations (stable identity). Only SplitLayout's undo-recording /
 *   restore paths should call them; children go through `changeReference`.
 * - `setReferenceState` — replace all five at once (undo/redo restore,
 *   error reset, draft restore).
 * - `captureReferenceSnapshot` — stable getter for the latest state (undo
 *   entries, gallery same-content check), read via a ref so it never churns.
 */
export function useReferenceState() {
  const [source, setSource] = useState<ReferenceSource>('none');
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse');
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo | null>(null);

  /** Replace all five fields at once (setter identities are stable). */
  const setReferenceState = useCallback((snap: ReferenceSnapshot) => {
    setSource(snap.source);
    setReferenceMode(snap.referenceMode);
    setFixedImageUrl(snap.fixedImageUrl);
    setLocalImageUrl(snap.localImageUrl);
    setReferenceInfo(snap.referenceInfo);
  }, []);

  const setters = useMemo<ReferenceSetters>(
    () => ({
      setSource,
      setReferenceMode,
      setFixedImageUrl,
      setLocalImageUrl,
      setReferenceInfo,
      setAll: setReferenceState,
    }),
    [setReferenceState],
  );

  // Latest state for the stable `captureReferenceSnapshot` (prevents child
  // re-renders that a state-dependent callback would cause).
  const referenceStateRef = useRef<ReferenceSnapshot>({
    source,
    referenceMode,
    fixedImageUrl,
    localImageUrl,
    referenceInfo,
  });
  useEffect(() => {
    referenceStateRef.current = {
      source,
      referenceMode,
      fixedImageUrl,
      localImageUrl,
      referenceInfo,
    };
  });

  const captureReferenceSnapshot = useCallback(
    (): ReferenceSnapshot => ({ ...referenceStateRef.current }),
    [],
  );

  return {
    source,
    referenceMode,
    fixedImageUrl,
    localImageUrl,
    referenceInfo,
    setters,
    setReferenceState,
    captureReferenceSnapshot,
  };
}
