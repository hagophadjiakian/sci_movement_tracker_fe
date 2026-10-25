import React, { useState } from 'react';
import type { SessionEntry, SessionInfo } from '../types';

interface Props {
  sessions: SessionEntry[];
  onRetry: (localId: string) => void;
  onLoad: (serverId: string) => Promise<void>;
}

const badge: Record<string, string> = {
  uploading: 'bg-slate-700 text-slate-200',
  queued: 'bg-slate-700 text-slate-200',
  analyzing: 'bg-blue-900 text-blue-200',
  done: 'bg-emerald-900 text-emerald-200',
  error: 'bg-red-900 text-red-200',
};

const label = (j: string) => j.replace('axial.', '').replace('.', ' ').replace(/_/g, ' ');

function Result({ info }: { info: SessionInfo }) {
  const r = info.result!;
  const moved = r.joints.filter((j) => j.bouts > 0).sort((a, b) => b.bouts - a.bouts);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">{r.summary}</p>
      {r.ai_note && <p className="text-slate-400 italic border-l-2 border-slate-700 pl-3">{r.ai_note}</p>}
      {moved.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left font-medium">Joint</th>
              <th className="text-right font-medium">Bouts</th>
              <th className="text-right font-medium">Range</th>
              <th className="text-right font-medium">Visible</th>
            </tr>
          </thead>
          <tbody>
            {moved.map((j) => (
              <tr key={j.joint} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">{label(j.joint)}</td>
                <td className="py-1 text-right">{j.bouts}</td>
                <td className="py-1 text-right">{j.min_deg?.toFixed(0)}° to {j.max_deg?.toFixed(0)}°</td>
                <td className="py-1 text-right">{Math.round(j.visible_fraction * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.bouts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-400 text-xs">All {r.bouts.length} movement bouts</summary>
          <table className="w-full text-xs mt-2">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-medium">Time</th>
                <th className="text-left font-medium">Joint</th>
                <th className="text-right font-medium">Size</th>
                <th className="text-left font-medium pl-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {r.bouts.slice(0, 300).map((b, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="py-1 font-mono">{b.start.toFixed(1)}s</td>
                  <td className="py-1">{label(b.joint)}</td>
                  <td className="py-1 text-right">{b.excursion_deg.toFixed(0)}°</td>
                  <td className="py-1 pl-2 text-amber-300">
                    {[
                      b.driver === 'trunk' && 'trunk drove it',
                      b.driver === 'thigh' && <span className="text-emerald-300">thigh moved</span>,
                      b.axial_led && `trunk led by ${b.lead_ms} ms`,
                      b.clonus_like && `clonus-like ${b.oscillation_hz} Hz`,
                    ]
                      .filter(Boolean)
                      .map((f, k) => (
                        <span key={k} className="mr-2">{f}</span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ul className="text-xs text-slate-500 list-disc pl-4">
        {r.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export const SessionList: React.FC<Props> = ({ sessions, onRetry, onLoad }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (sessions.length === 0)
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-sm text-slate-400">
        No recordings yet. Turn on voice control and say “Hagop”, or press Start recording.
      </div>
    );
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
      <h3 className="font-semibold text-slate-200">Recordings</h3>
      {sessions.map((s) => {
        const status = s.uploading ? 'uploading' : s.uploadError ? 'error' : s.info?.status ?? 'queued';
        const isOpen = open === s.localId;
        return (
          <div key={s.localId} className="border border-slate-800 rounded-xl">
            <button
              className="w-full flex items-center gap-3 p-3 text-left"
              onClick={async () => {
                setOpen(isOpen ? null : s.localId);
                if (!isOpen && s.serverId && s.info?.status === 'done' && !s.info.result) await onLoad(s.serverId);
              }}
            >
              <span className="text-sm text-slate-200">{new Date(s.startedAt).toLocaleString()}</span>
              <span className="text-xs text-slate-400">{s.durationS < 60 ? `${Math.round(s.durationS)} s` : `${(s.durationS / 60).toFixed(1)} min`}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${badge[status]}`}>{status}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                {s.uploadError && (
                  <p className="text-xs text-red-300">
                    Upload failed: {s.uploadError}{' '}
                    <button className="underline" onClick={() => onRetry(s.localId)}>
                      Retry
                    </button>
                  </p>
                )}
                {s.info?.status === 'error' && <p className="text-xs text-red-300">{s.info.error}</p>}
                {(status === 'queued' || status === 'analyzing' || status === 'uploading') && (
                  <p className="text-xs text-slate-400">Analysing in the background. You can record another one now.</p>
                )}
                {s.info?.status === 'done' && s.info.result && <Result info={s.info} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
