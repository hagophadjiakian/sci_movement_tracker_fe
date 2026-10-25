import React, { useRef, useEffect, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Analysis } from '../types';

type Side = 'left' | 'right';

interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

interface Angles {
  shoulderElevation: number | null;
  elbowFlexion: number | null;
  wristDeviation: number | null;
}

interface MotionTrackerProps {
  sciLevel: string;
  clinicalContext: string;
  onAnalysisUpdate: (data: Analysis) => void;
}

// MediaPipe Pose landmark indices ("left"/"right" are the person's own sides).
const SIDES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, hip: 24 },
} as const;

const MIN_VISIBILITY = 0.5;
const UI_UPDATE_MS = 100;
const TASKS_VERSION = '0.10.14'; // keep in sync with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const API_BASE = import.meta.env.VITE_API_URL ?? '';
const EMPTY_ANGLES: Angles = { shoulderElevation: null, elbowFlexion: null, wristDeviation: null };

const isVisible = (...pts: (Pt | undefined)[]) =>
  pts.every((p) => p !== undefined && (p.visibility ?? 0) >= MIN_VISIBILITY);

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

// Angle at point b between a-b and c-b, in degrees (3D).
const angleAt = (a: Pt, b: Pt, c: Pt): number | null => {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const norm = Math.hypot(...v1) * Math.hypot(...v2);
  if (norm === 0) return null;
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const cos = Math.min(1, Math.max(-1, dot / norm));
  return (Math.acos(cos) * 180) / Math.PI;
};

// Visibility comes from the image landmarks; 3D geometry from the world landmarks (metric, camera-angle tolerant).
function computeAngles(image: Pt[], world: Pt[], side: Side): Angles {
  const ix = SIDES[side];
  const w = (i: number) => world[i];
  const n = (i: number) => image[i];

  const shoulderElevation = isVisible(n(ix.hip), n(ix.shoulder), n(ix.elbow))
    ? angleAt(w(ix.hip), w(ix.shoulder), w(ix.elbow))
    : null;

  const elbowInterior = isVisible(n(ix.shoulder), n(ix.elbow), n(ix.wrist))
    ? angleAt(w(ix.shoulder), w(ix.elbow), w(ix.wrist))
    : null;

  const wristInterior = isVisible(n(ix.elbow), n(ix.wrist), n(ix.pinky), n(ix.index))
    ? angleAt(w(ix.elbow), w(ix.wrist), mid(w(ix.pinky), w(ix.index)))
    : null;

  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    shoulderElevation: round(shoulderElevation),
    // 0 = straight, matching clinical convention.
    elbowFlexion: elbowInterior === null ? null : Math.round(180 - elbowInterior),
    wristDeviation: wristInterior === null ? null : Math.round(180 - wristInterior),
  };
}

function drawArm(ctx: CanvasRenderingContext2D, lm: Pt[], side: Side, width: number, height: number) {
  const ix = SIDES[side];
  const toPx = (p: Pt) => ({ x: p.x * width, y: p.y * height });
  const hand: Pt | undefined =
    lm[ix.pinky] && lm[ix.index] ? mid(lm[ix.pinky], lm[ix.index]) : undefined;
  const handVisible = isVisible(lm[ix.pinky], lm[ix.index]);

  const segments: [Pt | undefined, Pt | undefined, boolean][] = [
    [lm[ix.hip], lm[ix.shoulder], isVisible(lm[ix.hip], lm[ix.shoulder])],
    [lm[ix.shoulder], lm[ix.elbow], isVisible(lm[ix.shoulder], lm[ix.elbow])],
    [lm[ix.elbow], lm[ix.wrist], isVisible(lm[ix.elbow], lm[ix.wrist])],
    [lm[ix.wrist], hand, handVisible && isVisible(lm[ix.wrist])],
  ];

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#38bdf8';
  ctx.fillStyle = '#f8fafc';
  for (const [a, b, ok] of segments) {
    if (!a || !b || !ok) continue;
    const pa = toPx(a);
    const pb = toPx(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    for (const p of [pa, pb]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export const MotionTracker: React.FC<MotionTrackerProps> = ({ sciLevel, clinicalContext, onAnalysisUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<Side>('left');
  const anglesRef = useRef<Angles>(EMPTY_ANGLES); // latest angles, updated every frame
  const lastUiUpdate = useRef(0);

  const [side, setSide] = useState<Side>('left');
  const [angles, setAngles] = useState<Angles>(EMPTY_ANGLES); // throttled, for display
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    sideRef.current = side;
  }, [side]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarker | null = null;
    let lastVideoTime = -1;

    const failModel = (err: unknown) => {
      if (cancelled) return;
      console.error('Pose model error:', err);
      setModelStatus('error');
      setModelError(err instanceof Error ? err.message : String(err));
    };

    const loop = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return; // no new frame yet
      lastVideoTime = video.currentTime;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let next = EMPTY_ANGLES;
      if (landmarker) {
        try {
          const result = landmarker.detectForVideo(video, performance.now());
          const image = result.landmarks[0];
          const world = result.worldLandmarks[0];
          if (image && world) {
            next = computeAngles(image, world, sideRef.current);
            drawArm(ctx, image, sideRef.current, canvas.width, canvas.height);
          }
        } catch (err) {
          landmarker = null;
          failModel(err);
        }
      }

      anglesRef.current = next;
      const now = performance.now();
      if (now - lastUiUpdate.current >= UI_UPDATE_MS) {
        lastUiUpdate.current = now;
        setAngles(next);
      }
    };

    // Camera
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraStatus('running');
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setCameraStatus('error');
        setCameraError(err instanceof Error ? `${err.name}: ${err.message}` : 'Could not start the camera.');
      }
    })();

    // Pose model
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const create = (delegate: 'GPU' | 'CPU') =>
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        let lm: PoseLandmarker;
        try {
          lm = await create('GPU');
        } catch {
          lm = await create('CPU'); // some machines have no usable WebGL/GPU delegate
        }
        if (cancelled) {
          lm.close();
          return;
        }
        landmarker = lm;
        setModelStatus('ready');
      } catch (err) {
        failModel(err);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      landmarker?.close();
      landmarker = null;
    };
  }, []);

  // The shoulder angle is optional (it needs the hip in frame); the elbow is required.
  const canAnalyze = angles.elbowFlexion !== null;

  const sendToBackend = async () => {
    const a = anglesRef.current;
    if (a.elbowFlexion === null) {
      setRequestError('Arm not clearly visible. Move into frame so shoulder, elbow and wrist are tracked.');
      return;
    }
    setLoading(true);
    setRequestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analyze-movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sci_level: sciLevel,
          side,
          angles: {
            shoulderElevation: a.shoulderElevation, // null when the hip isn't tracked
            elbowFlexion: a.elbowFlexion,
            wristDeviation: a.wristDeviation, // null when the hand isn't tracked
            timestamp: Date.now(),
          },
          exercise_name: 'Arm Flexion / Tenodesis Evaluation',
          clinical_context: clinicalContext.trim() || null,
        }),
      });

      if (!res.ok) {
        let detail = `Server error (${res.status})`;
        try {
          const body = await res.json();
          if (typeof body?.detail === 'string') detail = body.detail;
          else if (Array.isArray(body?.detail)) detail = 'The server rejected the request data.';
        } catch {
          /* non-JSON error body */
        }
        throw new Error(detail);
      }

      const data = await res.json();
      if (!Array.isArray(data?.primary_muscles) || !Array.isArray(data?.secondary_muscles)) {
        throw new Error('Unexpected response from the server.');
      }
      onAnalysisUpdate(data as Analysis);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to reach the backend.');
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v: number | null) => (v === null ? '—' : `${v}°`);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-300">Tracked arm</span>
        <div className="flex gap-1">
          {(['left', 'right'] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`px-3 py-1 rounded-lg text-sm ${
                side === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {s === 'left' ? 'Left' : 'Right'}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full max-w-[640px] aspect-[4/3] bg-black rounded-xl overflow-hidden border border-slate-800">
        <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none" playsInline muted />
        <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />
        {(cameraStatus !== 'running' || modelStatus !== 'ready') && (
          <div className="absolute inset-x-0 bottom-0 p-2 text-center text-xs text-slate-200 bg-black/70">
            {cameraStatus === 'error'
              ? `Camera error: ${cameraError}`
              : modelStatus === 'error'
              ? `Pose model failed to load: ${modelError}`
              : cameraStatus === 'starting'
              ? 'Starting camera… allow access when your browser asks.'
              : 'Loading pose model (first load downloads a few MB)…'}
          </div>
        )}
      </div>

      <div className="w-full grid grid-cols-3 gap-4 my-4 text-center">
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Shoulder elevation</span>
          <span className="text-lg font-bold text-blue-400">{fmt(angles.shoulderElevation)}</span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Elbow flexion</span>
          <span className="text-lg font-bold text-blue-400">{fmt(angles.elbowFlexion)}</span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
          <span className="text-xs text-slate-400 block">Wrist deviation</span>
          <span className="text-lg font-bold text-blue-400">{fmt(angles.wristDeviation)}</span>
        </div>
      </div>

      {requestError && (
        <p className="w-full mb-3 text-sm text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg p-2">
          {requestError}
        </p>
      )}

      <button
        onClick={sendToBackend}
        disabled={loading || !canAnalyze}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-medium rounded-xl transition shadow-lg shadow-blue-600/20"
      >
        {loading ? 'Analyzing…' : canAnalyze ? 'Run AI Muscle Estimate' : 'Arm not tracked'}
      </button>
    </div>
  );
};