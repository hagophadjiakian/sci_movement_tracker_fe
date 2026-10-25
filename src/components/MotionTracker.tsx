import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Analysis } from '../types';
import {
  AngleMeta,
  HAND_SKELETON,
  HandPoints,
  POSE_SKELETON,
  Pt,
  Side,
  ZEROABLE,
  computeAngles,
  emptyValues,
  isSeen,
} from '../lib/angles';
import { SideTracker } from '../lib/sideTracker';
import { FinishedRecording, MAX_MS, SessionRecorder, StopReason } from '../lib/recorder';
import { VoiceListener, speak } from '../lib/voice';
import { AngleTables } from './AngleTables';

interface MotionTrackerProps {
  sciLevel: string;
  aisGrade: string;
  clinicalContext: string;
  onAnalysisUpdate: (data: Analysis) => void;
  onRecordingFinished: (rec: FinishedRecording) => void;
}

const UI_UPDATE_MS = 150;
const TASKS_VERSION = '0.10.14'; // keep in sync with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const API_BASE = import.meta.env.VITE_API_URL ?? '';
const NEUTRAL_KEY = 'neuromotion.neutral';
const COLORS = { left: '#38bdf8', right: '#fb923c', mid: '#e2e8f0' } as const;
const HAND_MATCH_DIST = 0.15; // max image distance between hand-model wrist and pose wrist

const loadNeutral = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(NEUTRAL_KEY) ?? '{}');
  } catch {
    return {};
  }
};

// Give each hand found by the hand model to the arm whose pose wrist is closest.
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

function draw(
  ctx: CanvasRenderingContext2D,
  pose: Pt[],
  hands: Partial<Record<Side, HandPoints>>,
  w: number,
  h: number,
  recording: boolean,
) {
  const ok = (i: number) => isSeen(pose[i]);
  ctx.lineWidth = recording ? 5 : 4;
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
  if (recording) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(20, 20, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const MotionTracker: React.FC<MotionTrackerProps> = ({
  sciLevel,
  aisGrade,
  clinicalContext,
  onAnalysisUpdate,
  onRecordingFinished,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valuesRef = useRef<Record<string, number | null>>(emptyValues());
  const rawRef = useRef<Record<string, number | null>>(emptyValues());
  const neutralRef = useRef<Record<string, number>>(loadNeutral());
  const lastUiUpdate = useRef(0);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const voiceRef = useRef<VoiceListener | null>(null);
  const sidesRef = useRef(new SideTracker());
  const finishedCb = useRef(onRecordingFinished);
  finishedCb.current = onRecordingFinished;

  const [values, setValues] = useState<Record<string, number | null>>(emptyValues());
  const [meta, setMeta] = useState<AngleMeta>({ frame: null, hand: { left: null, right: null } });
  const [fps, setFps] = useState(0);
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [handStatus, setHandStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [neutralSet, setNeutralSet] = useState(Object.keys(neutralRef.current).length > 0);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [recElapsed, setRecElapsed] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'listening' | 'unsupported' | 'error'>('off');
  const [voiceDetail, setVoiceDetail] = useState('');
  const [heard, setHeard] = useState('');

  // ---- recording control ---------------------------------------------------
  const startRecording = useCallback((how: string) => {
    if (recorderRef.current) {
      recorderRef.current.event('command', how);
      return;
    }
    recorderRef.current = new SessionRecorder(how);
    setRecElapsed(0);
    speak('Recording started. Five minutes.');
  }, []);

  const finishRecording = useCallback((reason: StopReason) => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecElapsed(null);
    const data = rec.finish(reason);
    speak(reason === 'time_limit' ? 'Five minutes reached. Recording saved, analysing now.' : 'Recording saved, analysing now.');
    if (data.t.length >= 2) finishedCb.current(data);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const rec = recorderRef.current;
      if (!rec) return;
      const { due, expired } = rec.tick();
      due.forEach((t) => speak(t));
      if (expired) finishRecording('time_limit');
      else setRecElapsed(rec.elapsedMs());
    }, 250);
    return () => window.clearInterval(id);
  }, [finishRecording]);

  const toggleVoice = () => {
    if (voiceRef.current) {
      voiceRef.current.stop();
      voiceRef.current = null;
      return;
    }
    const v = new VoiceListener({
      onCommand: (cmd, text) => (cmd === 'start' ? startRecording(text) : finishRecording('voice_stop')),
      onTranscript: (text, final) => {
        setHeard(text);
        if (final && recorderRef.current) recorderRef.current.event('note', text);
      },
      onStatus: (s, d) => {
        setVoiceStatus(s);
        setVoiceDetail(d ?? '');
      },
    });
    voiceRef.current = v;
    v.start();
  };
  useEffect(() => () => voiceRef.current?.stop(), []);

  // ---- neutral posture (for movements with no anatomical zero) -------------
  const setNeutral = () => {
    const raw = rawRef.current;
    const n: Record<string, number> = {};
    for (const k of ZEROABLE) if (raw[k] !== null && raw[k] !== undefined) n[k] = raw[k] as number;
    neutralRef.current = n;
    setNeutralSet(Object.keys(n).length > 0);
    try {
      localStorage.setItem(NEUTRAL_KEY, JSON.stringify(n));
    } catch {
      /* storage unavailable */
    }
    recorderRef.current?.event('note', 'neutral posture set');
  };
  const clearNeutral = () => {
    neutralRef.current = {};
    setNeutralSet(false);
    try {
      localStorage.removeItem(NEUTRAL_KEY);
    } catch {
      /* ignore */
    }
  };

  // ---- camera + models + per-frame loop -----------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let rafId = 0;
    let vfcId = 0;
    let stream: MediaStream | null = null;
    let pose: PoseLandmarker | null = null;
    let handLm: HandLandmarker | null = null;
    let lastVideoTime = -1;
    let frames = 0;
    let fpsT0 = performance.now();

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
      let m: AngleMeta = { frame: null, hand: { left: null, right: null } };
      if (pose) {
        try {
          const now = performance.now();
          const res = pose.detectForVideo(video, now);
          const img0 = res.landmarks[0] as Pt[] | undefined;
          const wld0 = res.worldLandmarks[0] as Pt[] | undefined;
          if (img0 && wld0) {
            const fixed = sidesRef.current.fix(img0, wld0);
            let hands: Partial<Record<Side, HandPoints>> = {};
            if (handLm) {
              try {
                const hr = handLm.detectForVideo(video, now);
                hands = assignHands(
                  fixed.image,
                  hr.landmarks.map((l, i) => ({ image: l as Pt[], world: hr.worldLandmarks[i] as Pt[] })),
                );
              } catch {
                /* hand model hiccup: carry on with pose-only hand points */
              }
            }
            const r = computeAngles(fixed.image, fixed.world, hands);
            raw = r.values;
            m = r.meta;
            draw(ctx, fixed.image, hands, canvas.width, canvas.height, !!recorderRef.current);
          } else {
            sidesRef.current.reset();
          }
        } catch (err) {
          pose = null;
          setModelStatus('error');
          setModelError(errText(err));
        }
      }

      // Apply the neutral posture to movements that have no anatomical zero.
      const vals = { ...raw };
      for (const [k, off] of Object.entries(neutralRef.current)) {
        const x = vals[k];
        if (x !== null && x !== undefined) vals[k] = Math.round((x - off) * 10) / 10;
      }
      rawRef.current = raw;
      valuesRef.current = vals;
      recorderRef.current?.push(vals);

      frames++;
      const now = performance.now();
      if (now - fpsT0 >= 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsT0)));
        frames = 0;
        fpsT0 = now;
      }
      if (now - lastUiUpdate.current >= UI_UPDATE_MS) {
        lastUiUpdate.current = now;
        setValues(vals);
        setMeta(m);
      }
    };

    // Process each real camera frame once (not every screen refresh).
    const schedule = () => {
      if (cancelled) return;
      const vv = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
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
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        const c = canvasRef.current;
        if (c && video.videoWidth) {
          c.width = video.videoWidth;
          c.height = video.videoHeight;
        }
        setCameraStatus('running');
        schedule();
      } catch (err) {
        if (cancelled) return;
        setCameraStatus('error');
        setCameraError(err instanceof Error ? `${err.name}: ${err.message}` : 'Could not start the camera.');
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
        setModelStatus('ready');
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
          setHandStatus('ready');
        } catch {
          setHandStatus('error'); // body tracking still works; fingers unavailable
        }
      } catch (err) {
        if (cancelled) return;
        setModelStatus('error');
        setModelError(errText(err));
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
      pose = null;
      handLm = null;
    };
  }, []);

  // ---- snapshot AI estimate ----------------------------------------------------
  const anyVisible = Object.values(values).some((v) => v !== null);

  const sendSnapshot = async () => {
    const channels = Object.fromEntries(Object.entries(valuesRef.current).filter(([, v]) => v !== null));
    setLoading(true);
    setRequestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analyze-movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sci_level: sciLevel,
          ais_grade: aisGrade,
          channels,
          exercise_name: 'Whole-body posture snapshot',
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
      if (!Array.isArray(data?.primary_muscles)) throw new Error('Unexpected response from the server.');
      onAnalysisUpdate(data as Analysis);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to reach the backend.');
    } finally {
      setLoading(false);
    }
  };

  const recording = recElapsed !== null;
  const remaining = recording ? MAX_MS - recElapsed : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center gap-4">
      <div className="w-full flex flex-wrap items-center gap-3">
        <button
          onClick={toggleVoice}
          className={`px-3 py-2 rounded-lg text-sm font-medium ${
            voiceStatus === 'listening' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {voiceStatus === 'listening' ? 'Voice on: say “Hagop” / “stop”' : 'Turn on voice control'}
        </button>
        {recording ? (
          <button onClick={() => finishRecording('button')} className="px-3 py-2 rounded-lg text-sm bg-red-600 text-white">
            End recording
          </button>
        ) : (
          <button
            onClick={() => startRecording('button')}
            className="px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Start recording
          </button>
        )}
        <button
          onClick={setNeutral}
          title="Sit or lie still in your normal posture, then press. Zeroes neck and shoulder-girdle movements."
          className="px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-200 hover:bg-slate-700"
        >
          {neutralSet ? 'Reset neutral posture' : 'Set neutral posture'}
        </button>
        {neutralSet && (
          <button onClick={clearNeutral} className="text-xs text-slate-400 underline">
            clear
          </button>
        )}
        <div className="ml-auto text-right">
          {recording ? (
            <span className="font-mono text-lg text-red-400">
              ● {mmss(recElapsed!)} <span className="text-xs text-slate-400">({mmss(remaining)} left)</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">Not recording</span>
          )}
        </div>
      </div>
      {(voiceStatus === 'unsupported' || voiceStatus === 'error') && (
        <p className="w-full text-xs text-amber-400">
          {voiceStatus === 'unsupported'
            ? 'This browser has no speech recognition. Use Chrome or Edge, or the buttons.'
            : `Voice error: ${voiceDetail}. Check microphone permission.`}
        </p>
      )}
      {voiceStatus === 'listening' && heard && <p className="w-full text-xs text-slate-500 truncate">Heard: “{heard}”</p>}

      <div className="relative w-full max-w-[720px] aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
        <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none" playsInline muted />
        <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full object-contain" />
        {recording && <div className="absolute inset-0 border-4 border-red-500/70 rounded-xl pointer-events-none" />}
        <div className="absolute top-2 right-2 text-xs bg-black/60 rounded px-2 py-0.5 text-slate-200">
          {fps} fps · hands {handStatus === 'ready' ? 'on' : handStatus === 'loading' ? 'loading' : 'off'}
        </div>
        {(cameraStatus !== 'running' || modelStatus !== 'ready') && (
          <div className="absolute inset-x-0 bottom-0 p-2 text-center text-xs text-slate-200 bg-black/70">
            {cameraStatus === 'error'
              ? `Camera error: ${cameraError}`
              : modelStatus === 'error'
              ? `Pose model failed to load: ${modelError}`
              : cameraStatus === 'starting'
              ? 'Starting camera… allow access when your browser asks.'
              : 'Loading pose and hand models (first load downloads about 15 MB)…'}
          </div>
        )}
      </div>
      <p className="w-full text-xs text-slate-500">
        Blue = left, orange = right (your own sides). The picture is not mirrored: your right arm appears on the left of the screen.
      </p>

      <AngleTables values={values} meta={meta} />

      {requestError && (
        <p className="w-full text-sm text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg p-2">{requestError}</p>
      )}
      <button
        onClick={sendSnapshot}
        disabled={loading || !anyVisible}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-medium rounded-xl transition"
      >
        {loading ? 'Analyzing…' : anyVisible ? 'AI estimate for this pose (snapshot)' : 'Body not tracked'}
      </button>
    </div>
  );
};
