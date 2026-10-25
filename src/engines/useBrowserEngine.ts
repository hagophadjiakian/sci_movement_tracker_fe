// Browser engine: camera + MediaPipe Pose and Hand models running in Chrome (approximate 3D).
import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  AngleMeta,
  HAND_SKELETON,
  HandPoints,
  POSE_SKELETON,
  Pt,
  Side,
  computeAngles,
  emptyValues,
  isSeen,
} from '../lib/angles';
import { SideTracker } from '../lib/sideTracker';

const TASKS_VERSION = '0.10.14'; // keep in sync with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const COLORS = { left: '#38bdf8', right: '#fb923c', mid: '#e2e8f0' } as const;
const HAND_MATCH_DIST = 0.15;

export type FrameHandler = (raw: Record<string, number | null>, meta: AngleMeta) => void;

function assignHands(pose: Pt[], hands: { image: Pt[]; world: Pt[] }[]): Partial<Record<Side, HandPoints>> {
  const wrists: Record<Side, Pt | undefined> = {
    left: isSeen(pose[15]) ? pose[15] : undefined,
    right: isSeen(pose[16]) ? pose[16] : undefined,
  };
  const pairs: { side: Side; i: number; d: number }[] = [];
  hands.forEach((h, i) => {
    for (const side of ['left', 'right'] as Side[]) {
      const w = wrists[side];
      if (!w || !h.image[0]) continue;
      const d = Math.hypot(h.image[0].x - w.x, h.image[0].y - w.y);
      if (d < HAND_MATCH_DIST) pairs.push({ side, i, d });
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const out: Partial<Record<Side, HandPoints>> = {};
  const used = new Set<number>();
  for (const p of pairs) {
    if (out[p.side] || used.has(p.i)) continue;
    out[p.side] = hands[p.i];
    used.add(p.i);
  }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, pose: Pt[], hands: Partial<Record<Side, HandPoints>>, w: number, h: number, rec: boolean) {
  const ok = (i: number) => isSeen(pose[i]);
  ctx.lineWidth = rec ? 5 : 4;
  for (const seg of POSE_SKELETON) {
    if (!ok(seg.a) || !ok(seg.b)) continue;
    ctx.strokeStyle = COLORS[seg.side];
    ctx.beginPath();
    ctx.moveTo(pose[seg.a].x * w, pose[seg.a].y * h);
    ctx.lineTo(pose[seg.b].x * w, pose[seg.b].y * h);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const side of ['left', 'right'] as Side[]) {
    const hp = hands[side];
    if (!hp) continue;
    ctx.strokeStyle = COLORS[side];
    for (const [a, b] of HAND_SKELETON) {
      ctx.beginPath();
      ctx.moveTo(hp.image[a].x * w, hp.image[a].y * h);
      ctx.lineTo(hp.image[b].x * w, hp.image[b].y * h);
      ctx.stroke();
    }
  }
  ctx.font = 'bold 16px system-ui, sans-serif';
  for (const [i, label, side] of [[15, 'L', 'left'], [16, 'R', 'right']] as const) {
    if (!ok(i)) continue;
    ctx.fillStyle = COLORS[side];
    ctx.fillText(label, pose[i].x * w + 8, pose[i].y * h - 8);
  }
}

export interface BrowserEngineState {
  cameraStatus: 'off' | 'starting' | 'running' | 'error';
  cameraError: string | null;
  modelStatus: 'loading' | 'ready' | 'error';
  modelError: string | null;
  handStatus: 'loading' | 'ready' | 'error';
  fps: number;
}

export function useBrowserEngine(
  active: boolean,
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  onFrame: FrameHandler,
  isRecording: () => boolean,
): BrowserEngineState {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const recRef = useRef(isRecording);
  recRef.current = isRecording;
  const [state, setState] = useState<BrowserEngineState>({
    cameraStatus: 'off', cameraError: null, modelStatus: 'loading', modelError: null, handStatus: 'loading', fps: 0,
  });
  const patch = (p: Partial<BrowserEngineState>) => setState((s) => ({ ...s, ...p }));

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) {
      patch({ cameraStatus: 'off' });
      return;
    }
    let cancelled = false;
    let rafId = 0;
    let vfcId = 0;
    let stream: MediaStream | null = null;
    let pose: PoseLandmarker | null = null;
    let handLm: HandLandmarker | null = null;
    let lastVideoTime = -1;
    let frames = 0;
    let fpsT0 = performance.now();
    const sides = new SideTracker();
    patch({ cameraStatus: 'starting', modelStatus: 'loading', handStatus: 'loading' });

    const errText = (err: unknown) =>
      err instanceof Error
        ? err.message
        : err instanceof Event
        ? 'could not download the model or WebAssembly files (check the internet connection)'
        : String(err);

    const process = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let raw = emptyValues();
      let meta: AngleMeta = { frame: null, hand: { left: null, right: null }, engine: 'mediapipe', dims: '3d' };
      if (pose) {
        try {
          const now = performance.now();
          const res = pose.detectForVideo(video, now);
          const img0 = res.landmarks[0] as Pt[] | undefined;
          const wld0 = res.worldLandmarks[0] as Pt[] | undefined;
          if (img0 && wld0) {
            const fixed = sides.fix(img0, wld0);
            let hands: Partial<Record<Side, HandPoints>> = {};
            if (handLm) {
              try {
                const hr = handLm.detectForVideo(video, now);
                hands = assignHands(fixed.image, hr.landmarks.map((l, i) => ({ image: l as Pt[], world: hr.worldLandmarks[i] as Pt[] })));
              } catch {
                /* carry on with pose-only hand points */
              }
            }
            const r = computeAngles(fixed.image, fixed.world, hands);
            raw = r.values;
            meta = { ...r.meta, engine: 'mediapipe', dims: '3d' };
            draw(ctx, fixed.image, hands, canvas.width, canvas.height, recRef.current());
          } else sides.reset();
        } catch (err) {
          pose = null;
          patch({ modelStatus: 'error', modelError: errText(err) });
        }
      }
      cb.current(raw, meta);
      frames++;
      const now = performance.now();
      if (now - fpsT0 >= 1000) {
        patch({ fps: Math.round((frames * 1000) / (now - fpsT0)) });
        frames = 0;
        fpsT0 = now;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      const vv = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (typeof vv.requestVideoFrameCallback === 'function') {
        vfcId = vv.requestVideoFrameCallback(() => {
          process();
          schedule();
        });
      } else {
        rafId = requestAnimationFrame(() => {
          if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            process();
          }
          schedule();
        });
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        const c = canvasRef.current;
        if (c && video.videoWidth) {
          c.width = video.videoWidth;
          c.height = video.videoHeight;
        }
        patch({ cameraStatus: 'running' });
        schedule();
      } catch (err) {
        if (cancelled) return;
        patch({ cameraStatus: 'error', cameraError: err instanceof Error ? `${err.name}: ${err.message}` : 'Could not start the camera.' });
      }
    })();

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const withFallback = async <T,>(make: (d: 'GPU' | 'CPU') => Promise<T>) => {
          try {
            return await make('GPU');
          } catch {
            return await make('CPU');
          }
        };
        const p = await withFallback((delegate) =>
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        );
        if (cancelled) return p.close();
        pose = p;
        patch({ modelStatus: 'ready' });
        try {
          const hl = await withFallback((delegate) =>
            HandLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: HAND_MODEL, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }),
          );
          if (cancelled) return hl.close();
          handLm = hl;
          patch({ handStatus: 'ready' });
        } catch {
          patch({ handStatus: 'error' });
        }
      } catch (err) {
        if (cancelled) return;
        patch({ modelStatus: 'error', modelError: errText(err) });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      const vv = video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
      if (vfcId && vv.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(vfcId);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      pose?.close();
      handLm?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return state;
}
