import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Analysis } from '../types';
import {
  AXIAL_JOINTS,
  BodyAngles,
  JOINT_LABELS,
  Pt,
  SIDE_JOINTS,
  SKELETON,
  computeBodyAngles,
  emptyAngles,
  flatten,
} from '../lib/angles';
import { FinishedRecording, MAX_MS, SessionRecorder, StopReason } from '../lib/recorder';
import { VoiceListener, speak } from '../lib/voice';

interface MotionTrackerProps {
  sciLevel: string;
  aisGrade: string;
  clinicalContext: string;
  onAnalysisUpdate: (data: Analysis) => void;
  onRecordingFinished: (rec: FinishedRecording) => void;
}

const MIN_VISIBILITY = 0.5;
const UI_UPDATE_MS = 100;
const TASKS_VERSION = '0.10.14'; // keep in sync with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function drawSkeleton(ctx: CanvasRenderingContext2D, lm: Pt[], w: number, h: number, recording: boolean) {
  const ok = (i: number) => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY;
  ctx.lineWidth = 4;
  ctx.strokeStyle = recording ? '#f87171' : '#38bdf8';
  for (const [a, b] of SKELETON) {
    if (!ok(a) || !ok(b)) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = '#f8fafc';
  lm.forEach((p, i) => {
    if (i < 11 && i !== 0 && i !== 7 && i !== 8) return; // skip face detail
    if (!ok(i)) return;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  });
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
  const anglesRef = useRef<BodyAngles>(emptyAngles());
  const lastUiUpdate = useRef(0);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const voiceRef = useRef<VoiceListener | null>(null);
  const finishedCb = useRef(onRecordingFinished);
  finishedCb.current = onRecordingFinished;

  const [angles, setAngles] = useState<BodyAngles>(emptyAngles());
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [recElapsed, setRecElapsed] = useState<number | null>(null); // null = not recording
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'listening' | 'unsupported' | 'error'>('off');
  const [voiceDetail, setVoiceDetail] = useState<string>('');
  const [heard, setHeard] = useState('');

  // ---- recording control -------------------------------------------------
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
    recorderRef.current = null; // a new recording can start right away
    setRecElapsed(null);
    const data = rec.finish(reason);
    speak(reason === 'time_limit' ? 'Five minutes reached. Recording saved, analysing now.' : 'Recording saved, analysing now.');
    if (data.t.length >= 2) finishedCb.current(data);
  }, []);

  // Timer: warnings at 4:00 and 4:30, end at 5:00.
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

  // ---- camera + pose loop ------------------------------------------------
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
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let next = emptyAngles();
      if (landmarker) {
        try {
          const result = landmarker.detectForVideo(video, performance.now());
          const image = result.landmarks[0];
          const world = result.worldLandmarks[0];
          if (image && world) {
            next = computeBodyAngles(image, world);
            drawSkeleton(ctx, image, canvas.width, canvas.height, !!recorderRef.current);
          }
        } catch (err) {
          landmarker = null;
          failModel(err);
        }
      }
      anglesRef.current = next;
      recorderRef.current?.push(flatten(next));

      const now = performance.now();
      if (now - lastUiUpdate.current >= UI_UPDATE_MS) {
        lastUiUpdate.current = now;
        setAngles(next);
      }
    };

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
          lm = await create('CPU');
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

  // ---- single-pose AI estimate (snapshot) --------------------------------
  const anyVisible = Object.values(flatten(angles)).some((v) => v !== null);

  const sendSnapshot = async () => {
    const a = anglesRef.current;
    setLoading(true);
    setRequestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analyze-movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sci_level: sciLevel,
          ais_grade: aisGrade,
          angles: { left: a.left, right: a.right, axial: a.axial, timestamp: Date.now() },
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

  const fmt = (v: number | null) => (v === null ? '—' : `${Math.round(v)}°`);
  const recording = recElapsed !== null;
  const remaining = recording ? MAX_MS - recElapsed : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center gap-4">
      {/* Recording / voice bar */}
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
          <button onClick={() => startRecording('button')} className="px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-200 hover:bg-slate-700">
            Start recording
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
      {voiceStatus === 'listening' && heard && (
        <p className="w-full text-xs text-slate-500 truncate">Heard: “{heard}”</p>
      )}

      <div className="relative w-full max-w-[640px] aspect-[4/3] bg-black rounded-xl overflow-hidden border border-slate-800">
        <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none" playsInline muted />
        <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />
        {recording && <div className="absolute inset-0 border-4 border-red-500/70 rounded-xl pointer-events-none" />}
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

      {/* Angle grid */}
      <div className="w-full grid md:grid-cols-2 gap-4 text-sm">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="text-left font-medium">Joint</th>
              <th className="text-right font-medium">Left</th>
              <th className="text-right font-medium">Right</th>
            </tr>
          </thead>
          <tbody>
            {SIDE_JOINTS.map((k) => (
              <tr key={k} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">{JOINT_LABELS[k]}</td>
                <td className="py-1 text-right font-mono text-blue-400">{fmt(angles.left[k])}</td>
                <td className="py-1 text-right font-mono text-blue-400">{fmt(angles.right[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400">
                <th className="text-left font-medium">Trunk, pelvis, neck</th>
                <th className="text-right font-medium">Angle</th>
              </tr>
            </thead>
            <tbody>
              {AXIAL_JOINTS.map((k) => (
                <tr key={k} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{JOINT_LABELS[k]}</td>
                  <td className="py-1 text-right font-mono text-blue-400">{fmt(angles.axial[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Hip flexion is thigh relative to trunk. “Thigh vs vertical” and “Trunk forward lean” show which one moved.
            Keep the camera level.
          </p>
        </div>
      </div>

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
