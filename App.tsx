import React, { useState } from 'react';
import { MotionTracker } from './components/MotionTracker';
import { MuscleVisualizer } from './components/MuscleVisualizer';
import type { Analysis } from './types';

export function App() {
  const [sciLevel, setSciLevel] = useState<string>('C6 Tetraplegia');
  const [clinicalContext, setClinicalContext] = useState<string>('');
  const [activeMuscles, setActiveMuscles] = useState<string[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<Analysis | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 p-4 flex justify-between items-center bg-slate-900/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-blue-400">NeuroMotion SCI Tracker</h1>
          <p className="text-xs text-slate-400">Real-time biomechanics and AI-estimated muscle contributions</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="sci-level" className="text-sm font-medium text-slate-300">SCI Level:</label>
          <select
            id="sci-level"
            value={sciLevel}
            onChange={(e) => setSciLevel(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="C5 Tetraplegia">C5 Tetraplegia</option>
            <option value="C6 Tetraplegia">C6 Tetraplegia</option>
            <option value="C7 Tetraplegia">C7 Tetraplegia</option>
            <option value="T10 Paraplegia">T10 Paraplegia</option>
          </select>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">
        <div className="lg:col-span-2 space-y-6">
          <MotionTracker
            sciLevel={sciLevel}
            clinicalContext={clinicalContext}
            onAnalysisUpdate={(data) => {
              setAiAnalysis(data);
              setActiveMuscles([...data.primary_muscles, ...data.secondary_muscles]);
            }}
          />

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <label htmlFor="ctx" className="text-sm font-semibold text-slate-300 block mb-1">
              Clinical context (optional)
            </label>
            <p className="text-xs text-slate-500 mb-2">
              E.g. known muscle grades (biceps 4/5, wrist extensors 3/5), gravity-eliminated or not, speed of movement.
              This is sent to the AI and makes the estimate more specific.
            </p>
            <textarea
              id="ctx"
              value={clinicalContext}
              onChange={(e) => setClinicalContext(e.target.value.slice(0, 1000))}
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="space-y-6">
          <MuscleVisualizer activeMuscles={activeMuscles} />

          {aiAnalysis && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <h3 className="font-bold text-lg text-emerald-400">AI Movement Estimate</h3>
              <p className="text-xs text-slate-500">
                Inferred from joint angles only. This is not a measurement of muscle activation.
              </p>
              <div className="space-y-2 text-sm text-slate-300">
                <p><strong>Confidence:</strong> <span className="text-white">{aiAnalysis.confidence}</span></p>
                <p><strong>Myotome level:</strong> <span className="text-white">{aiAnalysis.myotomes}</span></p>
                <p><strong>Likely primary:</strong> <span className="text-white">{aiAnalysis.primary_muscles.join(', ') || '—'}</span></p>
                <p><strong>Likely secondary:</strong> <span className="text-white">{aiAnalysis.secondary_muscles.join(', ') || '—'}</span></p>
                <p><strong>Possible compensation:</strong> <span className="text-amber-400">{aiAnalysis.compensation}</span></p>
                <p><strong>Limitations:</strong> <span className="text-slate-400">{aiAnalysis.limitations}</span></p>
                <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 italic">
                  {aiAnalysis.clinical_note}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
