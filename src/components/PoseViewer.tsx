import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Box } from '@mui/material';
import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { applyPose, type BoneResolver } from '../pose/poseMapping';
import type { PoseJson } from '../pose/poseTypes';
import { bundledVrmUrl, getBundledVrm, BUNDLED_VRMS } from '../pose/bundledVrms';

export type PoseVrmSource
  = | { kind: 'bundled'; vrmId: string }
    | { kind: 'user'; blob: Blob };

export interface PoseViewerActions {
  /** PNG data URL of the current view, or null before the model is ready. */
  captureScreenshot: () => string | null;
}

interface PoseViewerProps {
  /** Applied whenever it changes (undo/restore swap it from the outside). */
  pose: PoseJson | null;
  vrmSource: PoseVrmSource;
  onReady?: () => void;
  onLoadError?: (e: unknown) => void;
  actionsRef?: Ref<PoseViewerActions>;
}

const CAMERA_TARGET_Y = 0.9;
const CAMERA_DISTANCE = 4.5;

/**
 * Free-orbiting 3D mannequin viewer (three.js + three-vrm). Deliberately
 * independent from the shared ViewTransform camera — like the Sketchfab
 * browse iframe, the drawing panel leads while this is on screen, and grid
 * sync only happens after Fix-Angle captures a still image.
 */
export default function PoseViewer({ pose, vrmSource, onReady, onLoadError, actionsRef }: PoseViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const poseRef = useRef<PoseJson | null>(pose);

  const applyToVrm = (vrm: VRM, poseJson: PoseJson | null) => {
    const resolve: BoneResolver = name => vrm.humanoid.getNormalizedBoneNode(name);
    const reset = () => vrm.humanoid.resetNormalizedPose();
    if (poseJson) applyPose(resolve, reset, poseJson);
    else reset();
  };

  // Scene / renderer lifecycle (once per mount).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0xf0f0f0);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.2));
    const dir = new DirectionalLight(0xffffff, 1.8);
    dir.position.set(1, 2, 3);
    scene.add(dir);
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(
      30,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      50,
    );
    camera.position.set(0, CAMERA_TARGET_Y, CAMERA_DISTANCE);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, CAMERA_TARGET_Y, 0);
    controls.update();

    let lastTime = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      vrmRef.current?.update(delta);
      controls.update();
      renderer.render(scene, camera);
    });

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      const vrm = vrmRef.current;
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        vrmRef.current = null;
      }
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // VRM load (re-runs when the source changes).
  const sourceKey = vrmSource.kind === 'bundled' ? `bundled:${vrmSource.vrmId}` : 'user';
  const userBlob = vrmSource.kind === 'user' ? vrmSource.blob : null;
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    let url: string;
    if (userBlob) {
      objectUrl = URL.createObjectURL(userBlob);
      url = objectUrl;
    }
    else {
      const entry = getBundledVrm(sourceKey.replace(/^bundled:/, '')) ?? BUNDLED_VRMS[0];
      url = bundledVrmUrl(entry);
    }

    // Revoking twice (callback + cleanup) is a harmless no-op; the cleanup
    // revoke covers teardown while the load is still in flight, where the
    // loader callbacks might never run.
    const revokeObjectUrl = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    loader.load(
      url,
      (gltf) => {
        revokeObjectUrl();
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          if (!cancelled) onLoadError?.(new Error('not a VRM file'));
          return;
        }
        if (cancelled) {
          VRMUtils.deepDispose(vrm.scene);
          return;
        }
        VRMUtils.rotateVRM0(vrm);
        const scene = sceneRef.current;
        const previous = vrmRef.current;
        if (previous && scene) {
          scene.remove(previous.scene);
          VRMUtils.deepDispose(previous.scene);
        }
        vrmRef.current = vrm;
        scene?.add(vrm.scene);
        applyToVrm(vrm, poseRef.current);
        onReady?.();
      },
      undefined,
      (e) => {
        revokeObjectUrl();
        if (!cancelled) onLoadError?.(e);
      },
    );

    return () => {
      cancelled = true;
      revokeObjectUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, userBlob]);

  // Re-apply when the pose changes (generation, undo/redo, draft restore).
  useEffect(() => {
    poseRef.current = pose;
    const vrm = vrmRef.current;
    if (vrm) applyToVrm(vrm, pose);
    // Not yet loaded: the load callback applies poseRef.current on arrival.
  }, [pose]);

  useImperativeHandle(actionsRef, () => ({
    captureScreenshot: () => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera || !vrmRef.current) return null;
      // Render synchronously right before reading pixels so the buffer is
      // valid without preserveDrawingBuffer.
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
  }), []);

  return <Box ref={containerRef} sx={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }} />;
}
