import React from 'react';
import {
  AXIAL_CHANNELS,
  AngleMeta,
  ChannelDef,
  FINGERS,
  FINGER_JOINTS,
  Reliability,
  SIDE_CHANNELS,
} from '../lib/angles';

interface Props {
  values: Record<string, number | null>;
  meta: AngleMeta;
}

const dotColor: Record<Reliability, string> = { good: '#10b981', fair: '#f59e0b', low: '#ef4444' };

const fmt = (v: number | null | undefined, unit: string) =>
  v === null || v === undefined ? '—' : `${Math.round(v)}${unit === '%' ? '%' : '°'}`;

function groupsOf(defs: ChannelDef[]) {
  const order: string[] = [];
  const by: Record<string, ChannelDef[]> = {};
  for (const d of defs) {
    if (!by[d.group]) {
      by[d.group] = [];
      order.push(d.group);
    }
    by[d.group].push(d);
  }
  return order.map((g) => ({ group: g, defs: by[g] }));
}

const Dot = ({ r }: { r: Reliability }) => (
  <span
    className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
    style={{ background: dotColor[r] }}
    title={`Reliability: ${r}`}
  />
);

function SideTable({ defs, values }: { defs: ChannelDef[]; values: Props['values'] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-400">
          <th className="text-left font-medium">Movement</th>
          <th className="text-right font-medium w-16">Left</th>
          <th className="text-right font-medium w-16">Right</th>
        </tr>
      </thead>
      <tbody>
        {defs.map((d) => (
          <tr key={d.key} className="border-t border-slate-800" title={d.sign}>
            <td className="py-1 text-slate-300">
              <Dot r={d.reliability} />
              {d.label}
              {d.sign && <span className="text-slate-500 text-xs ml-1.5">{d.sign}</span>}
            </td>
            <td className="py-1 text-right font-mono text-sky-400">{fmt(values[`left.${d.key}`], d.unit)}</td>
            <td className="py-1 text-right font-mono text-orange-400">{fmt(values[`right.${d.key}`], d.unit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FingerTable({ values, meta }: Props) {
  const extras = SIDE_CHANNELS.filter((c) => c.group === 'Fingers' && !/_(cmc|mcp|pip|dip|ip)$/.test(c.key));
  return (
    <div className="space-y-3">
      {(['left', 'right'] as const).map((side) => (
        <div key={side}>
          <p className={`text-xs mb-1 ${side === 'left' ? 'text-sky-400' : 'text-orange-400'}`}>
            {side === 'left' ? 'Left hand' : 'Right hand'}
            {meta.hand[side] === 'pose' && <span className="text-slate-500"> (hand model not locked; fingers unavailable)</span>}
            {meta.hand[side] === null && <span className="text-slate-500"> (not visible)</span>}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {FINGERS.map((f) => (
                <tr key={f} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300 capitalize w-20">{f}</td>
                  {FINGER_JOINTS[f].map((j) => (
                    <td key={j} className="py-1 text-right font-mono">
                      <span className="text-slate-500 text-xs mr-1">{j.toUpperCase()}</span>
                      <span className={side === 'left' ? 'text-sky-400' : 'text-orange-400'}>
                        {fmt(values[`${side}.${f}_${j}`], 'deg')}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <SideTable defs={extras} values={values} />
    </div>
  );
}

export const AngleTables: React.FC<Props> = ({ values, meta }) => {
  const sideGroups = groupsOf(SIDE_CHANNELS);
  const axialGroups = groupsOf(AXIAL_CHANNELS);
  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>
          Reference:{' '}
          <span className="text-slate-200">
            {meta.dims === '2d'
              ? `2D ${meta.view ?? ''} view${meta.facing ? `, facing ${meta.facing}` : ''}: only movements in the camera's plane are measured${
                  meta.view === 'side' ? ' (flexion/extension)' : meta.view === 'front' ? ' (abduction, side lean)' : ''
                }; fingers and wrist without direction`
              : meta.frame === 'trunk'
              ? 'trunk (hips visible)'
              : meta.frame === 'shoulders'
              ? 'shoulders only (hips hidden: hip, knee, trunk, pelvis not measured)'
              : 'body not found'}
          </span>
        </span>
        <span className="ml-auto">
          <Dot r="good" />good <Dot r="fair" />fair <Dot r="low" />low reliability
        </span>
      </div>

      {axialGroups.map(({ group, defs }) => (
        <details key={group} open className="bg-slate-800/40 rounded-lg px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">{group}</summary>
          <table className="w-full text-sm mt-1">
            <tbody>
              {defs.map((d) => (
                <tr key={d.key} className="border-t border-slate-800" title={d.sign}>
                  <td className="py-1 text-slate-300">
                    <Dot r={d.reliability} />
                    {d.label}
                    {d.sign && <span className="text-slate-500 text-xs ml-1.5">{d.sign}</span>}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-100 w-16">{fmt(values[`axial.${d.key}`], d.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      {sideGroups.map(({ group, defs }) => (
        <details key={group} open={group !== 'Segments'} className="bg-slate-800/40 rounded-lg px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">{group}</summary>
          <div className="mt-1">
            {group === 'Fingers' ? <FingerTable values={values} meta={meta} /> : <SideTable defs={defs} values={values} />}
          </div>
        </details>
      ))}
      <p className="text-xs text-slate-500">
        Toes: both engines give only toe tips (no toe joints), so toe bending cannot be measured from video. Rotations need the 3D browser engine or, later, several cameras.
      </p>
    </div>
  );
};
