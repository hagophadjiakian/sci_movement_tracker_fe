import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis } from '../types';
import { AngleMeta, ZEROABLE, emptyValues } from '../lib/angles';
import { FinishedRecording, MAX_MS, SessionRecorder, StopReason } from '../lib/recorder';
import { VoiceListener, speak } from '../lib/voice';
import { LiveDetector, LiveEvent, LiveMove, Sensitivity } from '../lib/liveDetector';
import { useBrowserEngine } from '../engines/useBrowserEngine';
import { DEFAULT_PYTHON_SETTINGS, PythonSettings, usePythonEngine } from '../engines/usePythonEngine';
import { AngleTables } from './AngleTables';

interface MotionTrackerProps {
  sciLevel: string;
  aisGrade: string;
  clinicalContext: string;
  onAnalysisUpdate: (data: Analysis) => void;
  onRecordingFinished: (rec: FinishedRecording) => void;
}

type EngineKind = 'browser' | 'python';
const UI_UPDATE_MS = 150;
const API_BASE = import.meta.env.VITE_API_URL ?? '';
const NEUTRAL_KEY = 'neuromotion.neutral';
const PREFS_KEY = 'neuromotion.prefs';

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const sel = 'bg-slate-800 border border-slate-700 text-sm rounded-lg px-2 py-1.5 text-white';

export const MotionTracker: React.FC<MotionTrackerProps> = ({
  sciLevel,
  aisGrade,
  clinicalContext,
  onAnalysisUpdate,
  onRecordingFinished,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prefs = useRef(load(PREFS_KEY, { engine: 'browser' as EngineKind, sensitivity: 'high' as Sensitivity, python: DEFAULT_PYTHON_SETTINGS }));
  const [engine, setEngine] = useState<EngineKind>(prefs.current.engine);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(prefs.current.sensitivity);
  const [py, setPy] = useState<PythonSettings>(prefs.current.python);
  useEffect(() => save(PREFS_KEY, { engine, sensitivity, python: py }), [engine, sensitivity, py]);

  const valuesRef = useRef<Record<string, number | null>>(emptyValues());
  const rawRef = useRef<Record<string, number | null>>(emptyValues());
  const neutralRef = useRef<Record<string, number>>(load(NEUTRAL_KEY, {}));
  const lastUiUpdate = useRef(0);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const voiceRef = useRef<VoiceListener | null>(null);
  const detectorRef = useRef(new LiveDetector(sensitivity));
  const finishedCb = useRef(onRecordingFinished);
  finishedCb.current = onRecordingFinished;

  const [values, setValues] = useState<Record<string, number | null>>(emptyValues());
  const [meta, setMeta] = useState<AngleMeta>({ frame: null, hand: { left: null, right: null } });
  const [moves, setMoves] = useState<LiveMove[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [neutralSet, setNeutralSet] = useState(Object.keys(neutralRef.current).length > 0);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [recElapsed, setRecElapsed] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'listening' | 'unsupported' | 'error'>('off');
  const [voiceDetail, setVoiceDetail] = useState('');
  const [heard, setHeard] = useState('');

  useEffect(() => {
    detectorRef.current.sensitivity = sensitivity;
  }, [sensitivity]);

  // ---- one handler for both engines ---------------------------------------------
  const handleFrame = useCallback((raw: Record<string, number | null>, m: AngleMeta) => {
    const vals = { ...raw };
    for (const [k, off] of Object.entries(neutralRef.current)) {
      const x = vals[k];
      if (x !== null && x !== undefined) vals[k] = Math.round((x - off) * 10) / 10;
    }
    rawRef.current = raw;
    valuesRef.current = vals;
    recorderRef.current?.push(vals);
    const now = performance.now();
    const mv = detectorRef.current.update(now / 1000, vals);
    if (now - lastUiUpdate.current >= UI_UPDATE_MS) {
      lastUiUpdate.current = now;
      setValues(vals);
      setMeta(m);
      setMoves(mv);
      setEvents([...detectorRef.current.events]);
    }
  }, []);

  const browser = useBrowserEngine(engine === 'browser', videoRef, canvasRef, handleFrame, () => !!recorderRef.current);
  const python = usePythonEngine(engine === 'python', handleFrame);

  const switchEngine = (e: EngineKind) => {
    if (recorderRef.current) return; // never switch mid-recording
    detectorRef.current.reset();
    setValues(emptyValues());
    setEngine(e);
  };

  // ---- recording -----------------------------------------------------------------
  const startRecording = useCallback((how: string) => {
    if (recorderRef.current) {
      recorderRef.current.event('command', how);
      return;
    }
    recorderRef.current = new SessionRecorder(how);
    setRecElapsed(0);
    speak('Recording started. Five minutes.');
  }, []);

  const finishRecording = useCallback(
    (reason: StopReason) => {
      const rec = recorderRef.current;
      if (!rec) return;
      recorderRef.current = null;
      setRecElapsed(null);
      const data = rec.finish(reason);
      data.engine = engine === 'python' ? 'rtmpose' : 'browser';
      data.sensitivity = sensitivity;
      speak(reason === 'time_limit' ? 'Five minutes reached. Recording saved, analysing now.' : 'Recording saved, analysing now.');
      if (data.t.length >= 2) finishedCb.current(data);
    },
    [engine, sensitivity],
  );
  const finishRef = useRef(finishRecording);
  finishRef.current = finishRecording;

  useEffect(() => {
    const id = window.setInterval(() => {
      const rec = recorderRef.current;
      if (!rec) return;
      const { due, expired } = rec.tick();
      due.forEach((t) => speak(t));
      if (expired) finishRef.current('time_limit');
      else setRecElapsed(rec.elapsedMs());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const toggleVoice = () => {
    if (voiceRef.current) {
      voiceRef.current.stop();
      voiceRef.current = null;
      return;
    }
    const v = new VoiceListener({
      onCommand: (cmd, text) => (cmd === 'start' ? startRecording(text) : finishRef.current('voice_stop')),
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

  // ---- neutral posture ---------------------------------------------------------------
  const setNeutral = () => {
    const raw = rawRef.current;
    const n: Record<string, number> = {};
    for (const k of ZEROABLE) if (raw[k] !== null && raw[k] !== undefined) n[k] = raw[k] as number;
    neutralRef.current = n;
    setNeutralSet(Object.keys(n).length > 0);
    save(NEUTRAL_KEY, n);
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

  // ---- snapshot AI estimate ---------------------------------------------------------------
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
  const pyRunning = python.status.state === 'running' || python.status.state === 'loading';
  const fps = engine === 'browser' ? browser.fps : python.status.fps;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center gap-4">
      {/* Engine switch */}
      <div className="w-full flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Engine</span>
        {(
          [
            ['browser', 'Browser (MediaPipe, 3D)'],
            ['python', 'Python (RTMPose, 2D, more accurate)'],
          ] as [EngineKind, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            disabled={recording}
            onClick={() => switchEngine(k)}
            className={`px-3 py-1.5 rounded-lg ${engine === k ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-slate-400">Sensitivity</span>
        <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)} className={sel}>
          <option value="high">High (slow, small movements)</option>
          <option value="medium">Medium</option>
          <option value="low">Low (only clear movements)</option>
        </select>
      </div>

      {engine === 'python' && (
        <div className="w-full bg-slate-800/40 rounded-lg p-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-slate-400">Camera</label>
            <input
              value={py.source}
              onChange={(e) => setPy({ ...py, source: e.target.value })}
              disabled={pyRunning}
              className={`${sel} w-28`}
              title="Camera number (0, 1, 2…) or a video file path on the computer running the backend"
              list="cams"
            />
            <datalist id="cams">
              {python.cameras.map((c) => (
                <option key={c.index} value={String(c.index)}>
                  {c.in_use ? 'in use' : `${c.width}×${c.height}`}
                </option>
              ))}
            </datalist>
            <button onClick={python.refreshCameras} disabled={pyRunning} className="text-xs text-slate-400 underline">
              find cameras
            </button>
            <select value={py.model} disabled={pyRunning} onChange={(e) => setPy({ ...py, model: e.target.value as PythonSettings['model'] })} className={sel}>
              <option value="wholebody">Body + hands + feet</option>
              <option value="body_feet">Body + feet (faster)</option>
              <option value="body">Body only (fastest)</option>
            </select>
            <select value={py.mode} disabled={pyRunning} onChange={(e) => setPy({ ...py, mode: e.target.value as PythonSettings['mode'] })} className={sel}>
              <option value="lightweight">Fast model</option>
              <option value="balanced">Balanced model</option>
              <option value="performance">Most accurate model</option>
            </select>
            <select value={py.device} disabled={pyRunning} onChange={(e) => setPy({ ...py, device: e.target.value as PythonSettings['device'] })} className={sel}>
              <option value="auto">Device: auto</option>
              <option value="cuda">NVIDIA GPU</option>
              <option value="cpu">CPU</option>
            </select>
            <select value={py.view} disabled={pyRunning} onChange={(e) => setPy({ ...py, view: e.target.value as PythonSettings['view'] })} className={sel}>
              <option value="auto">View: auto</option>
              <option value="side">Camera at my side</option>
              <option value="front">Camera in front of me</option>
            </select>
            {pyRunning ? (
              <button onClick={python.stop} disabled={recording} className="px-3 py-1.5 rounded-lg bg-slate-700 text-white">
                Stop camera
              </button>
            ) : (
              <button onClick={() => python.start(py)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white">
                Start camera
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {!python.connected
              ? 'Not connected to the Python backend. Start it with: python main.py'
              : python.status.state === 'loading'
              ? 'Loading the pose model… the first time downloads 100–300 MB, then it starts in seconds.'
              : python.status.state === 'running'
              ? `Running on ${python.status.device?.toUpperCase()} · ${python.status.people} person(s) in view · following the biggest / same person`
              : python.status.state === 'error'
              ? ''
              : 'Press Start camera.'}
          </p>
          {(python.status.state === 'error' || python.requestError) && (
            <p className="text-xs text-amber-400">{python.status.error ?? python.requestError}</p>
          )}
        </div>
      )}

      {/* Recording + voice bar */}
      <div className="w-full flex flex-wrap items-center gap-3">
        <button
          onClick={toggleVoice}
          className={`px-3 py-2 rounded-lg text-sm font-medium ${voiceStatus === 'listening' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
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

      {/* Video */}
      <div className="relative w-full max-w-[720px] aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
        <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none" playsInline muted />
        {engine === 'browser' ? (
          <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full object-contain" />
        ) : pyRunning ? (
          <img src={python.videoUrl} alt="Camera with tracked skeleton" className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">Python camera is off</div>
        )}
        {recording && <div className="absolute inset-0 border-4 border-red-500/70 rounded-xl pointer-events-none" />}
        <div className="absolute top-2 right-2 text-xs bg-black/60 rounded px-2 py-0.5 text-slate-200">
          {fps} fps
          {engine === 'browser' && ` · hands ${browser.handStatus === 'ready' ? 'on' : browser.handStatus === 'loading' ? 'loading' : 'off'}`}
        </div>
        {moves.length > 0 && (
          <div className="absolute top-2 left-2 space-y-1">
            {moves.slice(0, 4).map((m) => (
              <div key={m.channel} className="text-xs bg-emerald-600/90 text-white rounded px-2 py-0.5 animate-pulse">
                {m.label} {m.excursion}
                {m.unit}
              </div>
            ))}
          </div>
        )}
        {engine === 'browser' && (browser.cameraStatus !== 'running' || browser.modelStatus !== 'ready') && (
          <div className="absolute inset-x-0 bottom-0 p-2 text-center text-xs text-slate-200 bg-black/70">
            {browser.cameraStatus === 'error'
              ? `Camera error: ${browser.cameraError}`
              : browser.modelStatus === 'error'
              ? `Pose model failed to load: ${browser.modelError}`
              : browser.cameraStatus === 'starting'
              ? 'Starting camera… allow access when your browser asks.'
              : 'Loading pose and hand models (first load downloads about 15 MB)…'}
          </div>
        )}
      </div>
      <p className="w-full text-xs text-slate-500">
        Blue = left, orange = right (your own sides). The picture is not mirrored: your right arm appears on the left of the screen.
      </p>

      {/* Live movements */}
      <div className="w-full bg-slate-800/40 rounded-lg px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-200">Live movements</span>
          <span className="text-xs text-slate-500">a joint leaving its resting position, sensitivity {sensitivity}</span>
        </div>
        {moves.length === 0 && events.length === 0 && <p className="text-xs text-slate-500 mt-1">Nothing moving yet.</p>}
        {moves.length > 0 && (
          <p className="mt-1 text-emerald-300">Moving now: {moves.map((m) => `${m.label} ${m.excursion}${m.unit}`).join(' · ')}</p>
        )}
        {events.length > 0 && (
          <ul className="mt-1 text-xs text-slate-400 space-y-0.5">
            {events.slice(0, 8).map((e, i) => (
              <li key={`${e.channel}-${e.since}-${i}`}>
                {e.label}: {e.excursion}
                {e.unit} for {e.duration.toFixed(1)} s
              </li>
            ))}
          </ul>
        )}
      </div>

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
