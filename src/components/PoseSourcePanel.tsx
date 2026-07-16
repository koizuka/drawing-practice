import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, IconButton, Popover, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { History, PersonStanding, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import type { ReferenceInfo } from '../types';
import type { ReferenceSetters } from './ReferencePanel';
import type { PoseJson } from '../pose/poseTypes';
import { PoseParseError } from '../pose/poseTypes';
import { DEFAULT_VRM_ID, USER_VRM_ID } from '../pose/bundledVrms';
import { refinePoseUntilValid } from '../pose/poseRefineLoop';
import { anthropicErrorDetail, generatePose, getAnthropicApiKey, isAnthropicAuthError, mapAnthropicErrorKey, refinePose } from '../utils/anthropic';
import { isAbortError } from '../utils/pexels';
import { isSubmitEnter } from '../utils/imeSafeEnter';
import { addPoseHistory, deletePoseHistory, getPoseHistory, getUserVrm, saveUserVrm, touchPoseHistory, VrmTooLargeError, type PoseHistoryRecord } from '../storage';
import { dataUrlToJpegBlob } from '../utils/imageResize';
import PoseViewer, { type PoseViewerActions, type PoseVrmSource } from './PoseViewer';
import { PoseSketchPad, type PoseSketchPadHandle } from './PoseSketchPad';
import { ToolbarTooltip } from './ToolbarTooltip';

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
/** Longest edge of the pose-history thumbnail JPEG (Blob in IndexedDB). */
const POSE_HISTORY_THUMB_EDGE = 192;
/**
 * Cap for the model-reply excerpt shown in the error Alert. A refusal
 * explanation fits well under this; a long analysis that merely failed to
 * parse would otherwise flood the panel (the full text is in the console).
 */
const REPLY_DETAIL_MAX_CHARS = 400;

function clipReplyText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > REPLY_DETAIL_MAX_CHARS ? `${text.slice(0, REPLY_DETAIL_MAX_CHARS)}…` : text;
}

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
  // True while a validation-correction round is in flight (subset of
  // `generating`) — switches the button label to the refining message.
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string; keyAction: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vrmLoadFailed, setVrmLoadFailed] = useState(false);
  const [vrmRetryToken, setVrmRetryToken] = useState(0);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  // null = load in flight (popover shows a spinner until the read resolves).
  const [historyEntries, setHistoryEntries] = useState<PoseHistoryRecord[] | null>(null);
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
  // external swap necessarily supplies a different object. Our OWN generation
  // commit also swaps poseInfo but must NOT re-seed: the user may already be
  // typing the next hint while the refinement rounds run, and re-seeding
  // would revert the field to the request-time text — the commit remembers
  // its info object (state, so it is render-safe) and is skipped here.
  const [selfCommitted, setSelfCommitted] = useState<PoseSourcePanelProps['poseInfo']>(null);
  const [prevPoseInfo, setPrevPoseInfo] = useState(poseInfo);
  if (prevPoseInfo !== poseInfo) {
    setPrevPoseInfo(poseInfo);
    if (poseInfo && poseInfo === selfCommitted) {
      // One-shot: only the immediate post-commit swap skips. Undo history
      // restores the SAME object instance, so without clearing, redo back to
      // this pose would also skip and keep a stale hint/model toggle.
      setSelfCommitted(null);
    }
    else if (poseInfo) {
      setHint(poseInfo.hint ?? '');
      setVrmId(poseInfo.vrmId);
    }
  }

  // Any poseInfo swap also invalidates an in-flight/deferred generation — a
  // late result must not overwrite a reference the user just restored via
  // undo/redo/gallery (it would even add a new undo entry on top). This also
  // fires after our own generation success, where aborting the already-
  // settled request is a harmless no-op. No setState here: the aborted run's
  // .finally clears `generating` itself (abortRef still points at it).
  useEffect(() => {
    abortRef.current?.abort();
    pendingGenerateRef.current = false;
  }, [poseInfo]);

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
    // Sketch is optional when a hint is given — a clear enough hint alone
    // (e.g. 「両手を上げてジャンプ」) generates via the text-only prompt.
    const png = sketchRef.current?.exportPng() ?? null;
    if (!png && hint.trim() === '') {
      setError({ message: t('poseInputEmpty'), keyAction: false });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotice(null);
    setGenerating(true);
    setRefining(false);
    // Whether this run committed its result. measurePose leaves candidates
    // applied to the viewer, so a run that ends WITHOUT committing must put
    // the committed pose back — but only that case: restoring after a commit
    // would flash the stale pre-commit pose (poseRef updates in the viewer's
    // pose-prop effect, after this chain settles).
    let committed = false;
    generatePose(png, hint, controller.signal)
      // Geometric validation loop (bounded, best-effort): apply the candidate
      // to the mannequin, measure it, and let the model correct physically
      // implausible results in the same conversation. measure() returning
      // null on a superseded/aborted run stops the loop without extra calls.
      .then(generation => refinePoseUntilValid(generation, {
        measure: candidate => (controller.signal.aborted || abortRef.current !== controller)
          ? null
          : viewerActionsRef.current?.measurePose(candidate) ?? null,
        refine: (prior, feedback) => refinePose(prior, feedback, controller.signal),
        onRefineStart: () => setRefining(true),
        onRefineError: (e) => {
          if (controller.signal.aborted || abortRef.current !== controller) return;
          if (e instanceof PoseParseError) {
            setError({ message: t('posePoseParseError'), detail: clipReplyText(e.replyText), keyAction: false });
            return;
          }
          const key = mapAnthropicErrorKey(e);
          setError({ message: t(key), detail: anthropicErrorDetail(e), keyAction: isAnthropicAuthError(e) });
        },
      }))
      .then(({ pose: generated }) => {
        // A superseded run can still resolve (fetch may complete before
        // abort lands) — never let a stale pose overwrite a newer one, and
        // never apply after unmount.
        if (controller.signal.aborted || abortRef.current !== controller) return;
        const info: NonNullable<PoseSourcePanelProps['poseInfo']> = {
          source: 'pose',
          // hint/title deliberately stay the REQUEST-time values — they
          // describe the pose that was generated, not the textbox draft.
          title: hint.trim() || t('pose'),
          author: '',
          vrmId: vrmIdRef.current,
          pose: generated,
          hint: hint.trim() || undefined,
        };
        setSelfCommitted(info);
        onReferenceChange((s) => {
          s.setReferenceInfo(info);
        });
        committed = true;
        // Record the generation in pose history (best-effort, fire-and-
        // forget). The screenshot must be captured synchronously here: the
        // refine loop's measurePose left the final candidate — which IS the
        // committed pose — applied to the viewer, so the shot matches the
        // recorded JSON. Null when the viewer isn't ready (hint-only
        // generation racing the VRM load) — the entry is saved without a
        // thumbnail.
        const shot = viewerActionsRef.current?.captureScreenshot() ?? null;
        void (async () => {
          const thumbnail = shot
            ? await dataUrlToJpegBlob(shot, POSE_HISTORY_THUMB_EDGE, 0.8) ?? undefined
            : undefined;
          await addPoseHistory({
            pose: generated,
            hint: info.hint,
            thumbnail,
            createdAt: new Date(),
          });
        })().catch(() => { /* history is best-effort — never surface */ });
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (controller.signal.aborted || abortRef.current !== controller) return;
        if (e instanceof PoseParseError) {
          setError({ message: t('posePoseParseError'), detail: clipReplyText(e.replyText), keyAction: false });
          return;
        }
        const key = mapAnthropicErrorKey(e);
        setError({ message: t(key), detail: anthropicErrorDetail(e), keyAction: isAnthropicAuthError(e) });
      })
      .finally(() => {
        if (abortRef.current === controller) {
          setGenerating(false);
          setRefining(false);
        }
        // measurePose may have left an uncommitted candidate applied — put
        // the committed pose back, but only when this run still owns the
        // viewer (a superseded run must not stomp the newer run's display)
        // and didn't commit (the pose prop re-applies a committed result;
        // restoring would flash the stale pre-effect poseRef value).
        if (abortRef.current === controller && !committed) {
          viewerActionsRef.current?.restorePose();
        }
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

  const handleOpenHistory = useCallback((e: MouseEvent<HTMLElement>) => {
    setHistoryAnchor(e.currentTarget);
    setHistoryEntries(null);
    getPoseHistory().then(setHistoryEntries).catch(() => setHistoryEntries([]));
  }, []);

  const handleCloseHistory = useCallback(() => setHistoryAnchor(null), []);

  const handleSelectHistory = useCallback((entry: PoseHistoryRecord) => {
    setHistoryAnchor(null);
    setError(null);
    setNotice(null);
    // LRU bump — re-applied poses sort to the top and survive eviction.
    if (entry.id !== undefined) {
      touchPoseHistory(entry.id).catch(() => { /* best-effort */ });
    }
    // Committed exactly like a fresh generation result (one undo entry),
    // onto the CURRENTLY selected model — the stored pose is model-
    // independent. Deliberately NOT marked selfCommitted: the poseInfo
    // re-seed should update the hint field to the restored pose's hint, and
    // the swap's abort of any in-flight generation is intended.
    onReferenceChange((s) => {
      s.setReferenceInfo({
        source: 'pose',
        title: entry.hint?.trim() || t('pose'),
        author: '',
        vrmId: vrmIdRef.current,
        pose: entry.pose,
        hint: entry.hint,
      });
    });
  }, [onReferenceChange]);

  const handleDeleteHistory = useCallback((id: number | undefined) => {
    if (id === undefined) return;
    // Optimistic removal — the popover stays open for further picks/deletes.
    setHistoryEntries(entries => entries?.filter(e => e.id !== id) ?? entries);
    deletePoseHistory(id).catch(() => { /* best-effort */ });
  }, []);

  // ObjectURLs for the stored thumbnail Blobs; revoked when the list changes
  // or the panel unmounts.
  const historyThumbUrls = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of historyEntries ?? []) {
      if (entry.id !== undefined && entry.thumbnail) {
        map.set(entry.id, URL.createObjectURL(entry.thumbnail));
      }
    }
    return map;
  }, [historyEntries]);
  useEffect(() => () => {
    for (const url of historyThumbUrls.values()) URL.revokeObjectURL(url);
  }, [historyThumbUrls]);

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
      // A mid-refinement measurePose may have an uncommitted candidate on
      // screen — capture must show the COMMITTED pose that gets recorded.
      viewerActionsRef.current?.restorePose();
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
            onKeyDown={(e) => { if (isSubmitEnter(e) && !generating) handleGenerate(); }}
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
              {generating ? t(refining ? 'poseRefining' : 'poseGenerating') : t('poseGenerate')}
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
            <Button size="small" variant="outlined" startIcon={<History size={16} />} onClick={handleOpenHistory}>
              {t('poseHistory')}
            </Button>
          </Box>
          <Popover
            open={historyAnchor !== null}
            anchorEl={historyAnchor}
            onClose={handleCloseHistory}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <Box sx={{ p: 1, width: 320, maxHeight: 360, overflowY: 'auto' }}>
              {historyEntries === null
                ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                      <CircularProgress size={24} />
                    </Box>
                  )
                : historyEntries.length === 0
                  ? (
                      <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                        {t('poseHistoryEmpty')}
                      </Typography>
                    )
                  : (
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 1 }}>
                        {historyEntries.map((entry) => {
                          const thumbUrl = entry.id !== undefined ? historyThumbUrls.get(entry.id) : undefined;
                          return (
                            // ButtonBase (same rationale as BundledTemplatePicker)
                            // so the card is Tab-reachable and Enter/Space-
                            // activatable — but as component="div": the card
                            // CONTAINS the delete IconButton, and a native
                            // <button> may not nest another <button>. MUI still
                            // supplies role="button"/tabIndex/keyboard handling.
                            <ButtonBase
                              key={entry.id}
                              component="div"
                              focusRipple
                              aria-label={entry.hint || t('pose')}
                              onClick={() => handleSelectHistory(entry)}
                              sx={{
                                'display': 'block',
                                'textAlign': 'left',
                                'border': '1px solid #ddd',
                                'borderRadius': 1,
                                'overflow': 'hidden',
                                'cursor': 'pointer',
                                'position': 'relative',
                                '&:hover': { borderColor: 'primary.main' },
                                '&:focus-visible': { borderColor: 'primary.main', outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                              }}
                            >
                              {thumbUrl
                                ? <Box component="img" src={thumbUrl} alt={entry.hint || t('pose')} sx={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                                : (
                                    <Box sx={{ width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f0f0f0', color: 'text.secondary' }}>
                                      <PersonStanding size={32} />
                                    </Box>
                                  )}
                              <ToolbarTooltip title={t('poseHistoryDelete')}>
                                <IconButton
                                  size="small"
                                  aria-label={t('poseHistoryDelete')}
                                  // Touch devices commit selection on pointerdown
                                  // (before click), so stop propagation there too.
                                  onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                  onClick={(e) => { e.stopPropagation(); handleDeleteHistory(entry.id); }}
                                  sx={{ 'position': 'absolute', 'top': 2, 'right': 2, 'bgcolor': 'rgba(255,255,255,0.7)', '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' } }}
                                >
                                  <Trash2 size={14} />
                                </IconButton>
                              </ToolbarTooltip>
                              <Typography variant="caption" noWrap sx={{ display: 'block', px: 0.5 }}>
                                {entry.hint || t('pose')}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.5, pb: 0.5 }}>
                                {entry.createdAt.toLocaleDateString()}
                              </Typography>
                            </ButtonBase>
                          );
                        })}
                      </Box>
                    )}
            </Box>
          </Popover>
          {error && (
            <Alert
              severity="error"
              action={error.keyAction
                ? <Button color="inherit" size="small" onClick={onRequestApiKey}>{t('pexelsApiKeySettings')}</Button>
                : undefined}
            >
              {error.message}
              {error.detail && (
                <Box component="div" sx={{ mt: 0.5, fontSize: '0.75rem', fontFamily: 'monospace', opacity: 0.8, overflowWrap: 'anywhere' }}>
                  {error.detail}
                </Box>
              )}
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
