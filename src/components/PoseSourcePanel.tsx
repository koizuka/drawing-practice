import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { t } from '../i18n';
import type { ReferenceInfo } from '../types';
import type { ReferenceSetters } from './ReferencePanel';
import type { PoseJson } from '../pose/poseTypes';
import { PoseParseError } from '../pose/poseTypes';
import { DEFAULT_VRM_ID, USER_VRM_ID } from '../pose/bundledVrms';
import { generatePose, getAnthropicApiKey, isAnthropicAuthError, mapAnthropicErrorKey } from '../utils/anthropic';
import { isAbortError } from '../utils/pexels';
import { getUserVrm, saveUserVrm, VrmTooLargeError } from '../storage';
import PoseViewer, { type PoseViewerActions, type PoseVrmSource } from './PoseViewer';
import { PoseSketchPad, type PoseSketchPadHandle } from './PoseSketchPad';

export interface PoseSourceActions {
  /** Capture the current 3D view and fix it as the drawing reference. */
  fixAngle: () => void;
}

interface PoseSourcePanelProps {
  /** Current reference info when it is a pose (null before first generation). */
  poseInfo: Extract<ReferenceInfo, { source: 'pose' }> | null;
  onReferenceChange: (mutate: (setters: ReferenceSetters) => void) => void;
  /** Open the Anthropic API key dialog (parent owns it). */
  onRequestApiKey: () => void;
  /** Bumped by the parent whenever the key dialog closes (save OR cancel). */
  apiKeyVersion: number;
  /** False while the panel is mounted but hidden (fixed mode) — pauses the 3D render loop. */
  active?: boolean;
  actionsRef?: Ref<PoseSourceActions>;
  /** Reports whether the 3D viewer is ready (enables the Fix-Angle button). */
  onViewerReadyChange?: (ready: boolean) => void;
}

const SKETCH_DISPLAY_SIZE = 160;

/**
 * Browse-mode UI for the 'pose' reference source: stick-figure sketch pad +
 * hint field + generate button on top, free-orbiting VRM mannequin below.
 * Loaded lazily — this module pulls in three.js via PoseViewer.
 */
export default function PoseSourcePanel({
  poseInfo,
  onReferenceChange,
  onRequestApiKey,
  apiKeyVersion,
  active = true,
  actionsRef,
  onViewerReadyChange,
}: PoseSourcePanelProps) {
  const sketchRef = useRef<PoseSketchPadHandle>(null);
  const viewerActionsRef = useRef<PoseViewerActions>(null);
  const [hint, setHint] = useState(() => poseInfo?.hint ?? '');
  const [vrmId, setVrmId] = useState(() => poseInfo?.vrmId ?? DEFAULT_VRM_ID);
  const [userVrmBlob, setUserVrmBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<{ message: string; keyAction: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vrmLoadFailed, setVrmLoadFailed] = useState(false);
  const [vrmRetryToken, setVrmRetryToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set when Generate was clicked without a key: the key dialog is open and a
  // successful save should finish the original generate intent.
  const pendingGenerateRef = useRef(false);

  const pose: PoseJson | null = poseInfo?.pose ?? null;

  // Re-seed hint/vrmId when poseInfo is swapped from the outside (undo/redo,
  // gallery load) — otherwise the hint field, model toggle, and Fix-Angle
  // metadata keep stale values. Render-time prev-comparison per React docs
  // (same pattern as ReferencePanel's YouTube state reset). Detect by object
  // identity, NOT referenceKey — the key deliberately excludes hint (and
  // imageUrl), so two infos differing only there would be missed, while every
  // external swap necessarily supplies a different object.
  const [prevPoseInfo, setPrevPoseInfo] = useState(poseInfo);
  if (prevPoseInfo !== poseInfo) {
    setPrevPoseInfo(poseInfo);
    if (poseInfo) {
      setHint(poseInfo.hint ?? '');
      setVrmId(poseInfo.vrmId);
    }
  }

  // Resolve the saved user VRM on mount — also when the bundled model is
  // selected, so the "My VRM" toggle is enabled in a fresh session. The
  // missing-model fallback only fires when 'user' was actually requested
  // (draft restore pointing at a since-deleted record).
  useEffect(() => {
    if (userVrmBlob) return;
    let cancelled = false;
    const fallbackToBundled = () => {
      setNotice(t('poseVrmUserMissing'));
      setVrmId(current => (current === USER_VRM_ID ? DEFAULT_VRM_ID : current));
    };
    getUserVrm().then((record) => {
      if (cancelled) return;
      if (record) {
        setUserVrmBlob(record.blob);
      }
      else if (vrmId === USER_VRM_ID) {
        fallbackToBundled();
      }
    }).catch(() => {
      if (cancelled) return;
      if (vrmId === USER_VRM_ID) fallbackToBundled();
    });
    return () => { cancelled = true; };
  }, [vrmId, userVrmBlob]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Latest committed vrmId, for the generate success handler: the pose is
  // model-independent, so the result should respect a model switch made
  // while the request was in flight instead of snapping the toggle back to
  // the click-time selection via the poseInfo re-seed above.
  const vrmIdRef = useRef(vrmId);
  useEffect(() => {
    vrmIdRef.current = vrmId;
  }, [vrmId]);

  const runGenerate = useCallback(() => {
    const png = sketchRef.current?.exportPng() ?? null;
    if (!png) {
      setError({ message: t('poseSketchEmpty'), keyAction: false });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotice(null);
    setGenerating(true);
    generatePose(png, hint, controller.signal)
      .then((generated) => {
        // A superseded run can still resolve (fetch may complete before
        // abort lands) — never let a stale pose overwrite a newer one, and
        // never apply after unmount.
        if (controller.signal.aborted || abortRef.current !== controller) return;
        onReferenceChange((s) => {
          s.setReferenceInfo({
            source: 'pose',
            // hint/title deliberately stay the REQUEST-time values — they
            // describe the pose that was generated, not the textbox draft.
            title: hint.trim() || t('pose'),
            author: '',
            vrmId: vrmIdRef.current,
            pose: generated,
            hint: hint.trim() || undefined,
          });
        });
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (controller.signal.aborted || abortRef.current !== controller) return;
        if (e instanceof PoseParseError) {
          setError({ message: t('posePoseParseError'), keyAction: false });
          return;
        }
        const key = mapAnthropicErrorKey(e);
        setError({ message: t(key), keyAction: isAnthropicAuthError(e) });
      })
      .finally(() => {
        if (abortRef.current === controller) setGenerating(false);
      });
  }, [hint, onReferenceChange]);

  const handleGenerate = useCallback(() => {
    if (getAnthropicApiKey() === '') {
      pendingGenerateRef.current = true;
      onRequestApiKey();
      return;
    }
    runGenerate();
  }, [onRequestApiKey, runGenerate]);

  // Resolve a pending generate when the key dialog closes: run it if a key
  // was saved, otherwise drop the intent (a cancelled dialog must not leave
  // it armed for a later unrelated key save).
  const prevKeyVersionRef = useRef(apiKeyVersion);
  useEffect(() => {
    if (prevKeyVersionRef.current === apiKeyVersion) return;
    prevKeyVersionRef.current = apiKeyVersion;
    if (!pendingGenerateRef.current) return;
    pendingGenerateRef.current = false;
    if (getAnthropicApiKey() !== '') runGenerate();
  }, [apiKeyVersion, runGenerate]);

  const handleLoadVrmFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vrm';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setNotice(null);
      setError(null);
      saveUserVrm(file)
        .catch((e: unknown) => {
          if (e instanceof VrmTooLargeError) {
            setError({ message: t('poseVrmTooLarge'), keyAction: false });
            throw e;
          }
          // Other persistence failures (e.g. quota): still preview the model
          // this session, but say so — otherwise the UI implies it survives
          // reload when it won't.
          setNotice(t('poseVrmPersistFailed'));
        })
        .then(() => {
          setUserVrmBlob(file);
          setVrmLoadFailed(false);
          setVrmId(USER_VRM_ID);
        })
        .catch(() => { /* size error already surfaced */ });
    };
    input.click();
  }, []);

  const handleVrmChoice = useCallback((_: unknown, value: string | null) => {
    if (!value) return;
    setVrmLoadFailed(false);
    setVrmId(value);
  }, []);

  const handleViewerReady = useCallback(() => {
    setVrmLoadFailed(false);
    onViewerReadyChange?.(true);
  }, [onViewerReadyChange]);

  const handleViewerLoadError = useCallback(() => {
    setVrmLoadFailed(true);
    onViewerReadyChange?.(false);
  }, [onViewerReadyChange]);

  useImperativeHandle(actionsRef, () => ({
    fixAngle: () => {
      const screenshot = viewerActionsRef.current?.captureScreenshot() ?? null;
      if (!screenshot) return;
      // Fixing commits to the CURRENT view: cancel any in-flight generation
      // AND any key-dialog-deferred one, so a late result can't swap
      // referenceInfo (new pose, no imageUrl) underneath the just-captured
      // screenshot.
      abortRef.current?.abort();
      pendingGenerateRef.current = false;
      setGenerating(false);
      // Record the model actually on screen — while a user VRM is still
      // resolving, the viewer shows the bundled fallback, not 'user'.
      const effectiveVrmId = vrmId === USER_VRM_ID && !userVrmBlob ? DEFAULT_VRM_ID : vrmId;
      onReferenceChange((s) => {
        s.setFixedImageUrl(screenshot);
        s.setLocalImageUrl(null);
        s.setReferenceInfo({
          source: 'pose',
          title: (poseInfo?.hint ?? hint).trim() || t('pose'),
          author: '',
          vrmId: effectiveVrmId,
          pose: pose ?? undefined,
          hint: poseInfo?.hint ?? (hint.trim() || undefined),
          imageUrl: screenshot,
        });
        s.setReferenceMode('fixed');
      });
    },
  }), [onReferenceChange, poseInfo, hint, vrmId, userVrmBlob, pose]);

  const vrmSource: PoseVrmSource = vrmId === USER_VRM_ID && userVrmBlob
    ? { kind: 'user', blob: userVrmBlob }
    : { kind: 'bundled', vrmId: vrmId === USER_VRM_ID ? DEFAULT_VRM_ID : vrmId };

  // Disable Fix-Angle whenever the effective model source changes (toggle,
  // file load, undo/redo swapping vrmId) — a capture in the loading window
  // would screenshot the old mannequin while recording the new vrmId. The
  // new model's onReady re-enables it. Effect (not inline in the handlers)
  // so every path that changes the source is covered. Deps mirror exactly
  // what makes PoseViewer reload: keying on userVrmBlob while the bundled
  // model is shown would reset readiness on the mount-time user-VRM preload
  // (which triggers no reload), leaving Fix-Angle stuck disabled.
  const vrmSourceKey = vrmSource.kind === 'user' ? 'user' : `bundled:${vrmSource.vrmId}`;
  const activeUserBlob = vrmSource.kind === 'user' ? vrmSource.blob : null;
  useEffect(() => {
    onViewerReadyChange?.(false);
    // Re-run only on source-identity change; the callback identity is stable
    // in practice (parent useState setter wrapper).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmSourceKey, activeUserBlob]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Controls */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, p: 1, alignItems: 'flex-start' }}>
        <PoseSketchPad ref={sketchRef} displaySize={SKETCH_DISPLAY_SIZE} />
        <Box sx={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField
            size="small"
            label={t('poseHintLabel')}
            placeholder={t('poseHintPlaceholder')}
            value={hint}
            onChange={e => setHint(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !generating) handleGenerate(); }}
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="contained"
              onClick={handleGenerate}
              disabled={generating}
              startIcon={generating ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {generating ? t('poseGenerating') : t('poseGenerate')}
            </Button>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={vrmId}
              onChange={handleVrmChoice}
            >
              <ToggleButton value={DEFAULT_VRM_ID}>{t('poseModelBundled')}</ToggleButton>
              <ToggleButton value={USER_VRM_ID} disabled={!userVrmBlob && vrmId !== USER_VRM_ID}>
                {t('poseModelUser')}
              </ToggleButton>
            </ToggleButtonGroup>
            <Button size="small" variant="outlined" onClick={handleLoadVrmFile}>
              {t('poseLoadVrm')}
            </Button>
          </Box>
          {error && (
            <Alert
              severity="error"
              action={error.keyAction
                ? <Button color="inherit" size="small" onClick={onRequestApiKey}>{t('pexelsApiKeySettings')}</Button>
                : undefined}
            >
              {error.message}
            </Alert>
          )}
          {notice && <Alert severity="info" onClose={() => setNotice(null)}>{notice}</Alert>}
        </Box>
      </Box>

      {/* 3D viewer — free orbit, independent from the shared camera. */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {vrmLoadFailed
          ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1, p: 2 }}>
                <Alert severity="error">{t('poseVrmLoadFailed')}</Alert>
                <Button size="small" variant="outlined" onClick={() => { setVrmLoadFailed(false); setVrmRetryToken(v => v + 1); }}>
                  {t('poseRetry')}
                </Button>
              </Box>
            )
          : (
              <PoseViewer
                key={vrmRetryToken}
                pose={pose}
                vrmSource={vrmSource}
                active={active}
                onReady={handleViewerReady}
                onLoadError={handleViewerLoadError}
                actionsRef={viewerActionsRef}
              />
            )}
      </Box>
    </Box>
  );
}
