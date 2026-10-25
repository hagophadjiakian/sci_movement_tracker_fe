import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MotionTracker } from './components/MotionTracker';
import { MuscleVisualizer } from './components/MuscleVisualizer';
import { SessionList } from './components/SessionList';
import { AIS_GRADES, LEVEL_GROUPS } from './lib/levels';
import type { FinishedRecording } from './lib/recorder';
import type { Analysis, SessionEntry, SessionInfo } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 2000;

export function App() {
  const [sciLevel, setSciLevel] = useState('T6');
  const [aisGrade, setAisGrade] = useState('unknown');
  const [clinicalContext, setClinicalContext] = useState('');
  const [activeMuscles, setActiveMuscles] = useState<string[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<Analysis | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const payloads = useRef(new Map<string, unknown>()); // kept for retry after a failed upload
  const settings = useRef({ sciLevel, aisGrade, clinicalContext });
  settings.current = { sciLevel, aisGrade, clinicalContext };

  const patch = (localId: string, p: Partial<SessionEntry>) =>
    setSessions((list) => list.map((s) => (s.localId === localId ? { ...s, ...p } : s)));

  const upload = useCallback(async (localId: string) => {
    const body = payloads.current.get(localId);
    if (!body) return;
    patch(localId, { uploading: true, uploadError: undefined });
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `Server error (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j?.detail === 'string') detail = j.detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const info: SessionInfo = await res.json();
      payloads.current.delete(localId);
      patch(localId, { uploading: false, serverId: info.id, info });
    } catch (err) {
      patch(localId, { uploading: false, uploadError: err instanceof Error ? err.message : 'Network error' });
    }
  }, []);

  // A recording just ended: queue it and keep going. The next one can start immediately.
  const onRecordingFinished = useCallback(
    (rec: FinishedRecording) => {
      const localId = crypto.randomUUID();
      const { sciLevel, aisGrade, clinicalContext } = settings.current;
      payloads.current.set(localId, {
        sci_level: sciLevel,
        ais_grade: aisGrade,
        exercise_name: 'Voice-started session',
        clinical_context: clinicalContext.trim() || null,
        started_at: rec.startedAt,
        stop_reason: rec.stopReason,
        sensitivity: rec.sensitivity ?? 'medium',
        engine: rec.engine ?? 'browser',
        t: rec.t,
        joints: rec.joints,
        events: rec.events,
      });
      setSessions((list) => [
        { localId, uploading: true, startedAt: rec.startedAt, durationS: rec.t[rec.t.length - 1] ?? 0 },
        ...list,
      ]);
      void upload(localId);
    },
    [upload],
  );

  // Earlier sessions from the server.
  useEffect(() => {
    fetch(`${API_BASE}/api/sessions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((items: SessionInfo[]) =>
        setSessions((list) => [
          ...list,
          ...items
            .filter((i) => !list.some((s) => s.serverId === i.id))
            .map((i) => ({ localId: i.id, serverId: i.id, uploading: false, info: i, startedAt: i.started_at, durationS: i.duration_s })),
        ]),
      )
      .catch(() => undefined);
  }, []);

  // Poll sessions that are still being analysed.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  useEffect(() => {
    const id = window.setInterval(async () => {
      const pending = sessionsRef.current.filter(
        (s) => s.serverId && (s.info?.status === 'queued' || s.info?.status === 'analyzing'),
      );
      for (const s of pending) {
        try {
          const r = await fetch(`${API_BASE}/api/sessions/${s.serverId}`);
          if (r.ok) patch(s.localId, { info: await r.json() });
        } catch {
          /* try again next tick */
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const loadOne = useCallback(async (serverId: string) => {
    const r = await fetch(`${API_BASE}/api/sessions/${serverId}`);
    if (!r.ok) return;
    const info: SessionInfo = await r.json();
    setSessions((list) => list.map((s) => (s.serverId === serverId ? { ...s, info } : s)));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 p-4 flex flex-wrap gap-3 justify-between items-center bg-slate-900/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-blue-400">NeuroMotion SCI Tracker</h1>
          <p className="text-xs text-slate-400">Whole-body joint angles, voice-started 5-minute recordings, background analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="sci-level" className="text-sm text-slate-300">Level</label>
          <select
            id="sci-level"
            value={sciLevel}
            onChange={(e) => setSciLevel(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white"
          >
            {LEVEL_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.levels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <label htmlFor="ais" className="sr-only">AIS grade</label>
          <select
            id="ais"
            value={aisGrade}
            onChange={(e) => setAisGrade(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white"
          >
            {AIS_GRADES.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">
        <div className="lg:col-span-2 space-y-6">
          <MotionTracker
            sciLevel={sciLevel}
            aisGrade={aisGrade}
            clinicalContext={clinicalContext}
            onRecordingFinished={onRecordingFinished}
            onAnalysisUpdate={(data) => {
              setAiAnalysis(data);
              setActiveMuscles([...data.primary_muscles, ...data.secondary_muscles]);
            }}
          />
          <SessionList sessions={sessions} onRetry={upload} onLoad={loadOne} />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <label htmlFor="ctx" className="text-sm font-semibold text-slate-300 block mb-1">Clinical context (optional)</label>
            <p className="text-xs text-slate-500 mb-2">
              E.g. known muscle grades (hip flexors 2/5, quadriceps 1/5), spasm medication, lying or sitting.
            </p>
            <textarea
              id="ctx"
              value={clinicalContext}
              onChange={(e) => setClinicalContext(e.target.value.slice(0, 1000))}
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white"
            />
          </div>
        </div>

        <div className="space-y-6">
          <MuscleVisualizer activeMuscles={activeMuscles} />
          {aiAnalysis && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <h3 className="font-bold text-lg text-emerald-400">AI snapshot estimate</h3>
              <p className="text-xs text-slate-500">From one pose only. Not a measurement of muscle activation.</p>
              <div className="space-y-2 text-sm text-slate-300">
                <p><strong>Confidence:</strong> <span className="text-white">{aiAnalysis.confidence}</span></p>
                <p><strong>Myotome level:</strong> <span className="text-white">{aiAnalysis.myotomes}</span></p>
                <p><strong>Likely primary:</strong> <span className="text-white">{aiAnalysis.primary_muscles.join(', ') || '—'}</span></p>
                <p><strong>Likely secondary:</strong> <span className="text-white">{aiAnalysis.secondary_muscles.join(', ') || '—'}</span></p>
                <p><strong>Possible compensation:</strong> <span className="text-amber-400">{aiAnalysis.compensation}</span></p>
                <p><strong>Limitations:</strong> <span className="text-slate-400">{aiAnalysis.limitations}</span></p>
                <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 italic">{aiAnalysis.clinical_note}</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
