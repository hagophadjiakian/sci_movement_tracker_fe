import React from 'react';

interface MuscleVisualizerProps {
  activeMuscles: string[];
}

// Each region lists the words an AI answer might use for it.
const REGIONS: { id: string; label: string; keys: string[]; color: string }[] = [
  { id: 'neck', label: 'Neck / trapezius', keys: ['trapez', 'sternocleido', 'scm', 'neck', 'levator'], color: '#3b82f6' },
  { id: 'deltoid', label: 'Deltoid / rotator cuff', keys: ['deltoid', 'supraspinatus', 'rotator', 'infraspinatus'], color: '#3b82f6' },
  { id: 'pec', label: 'Chest', keys: ['pectoral', 'serratus'], color: '#3b82f6' },
  { id: 'biceps', label: 'Elbow flexors', keys: ['biceps', 'brachialis', 'brachioradialis', 'elbow flexor'], color: '#3b82f6' },
  { id: 'triceps', label: 'Triceps', keys: ['triceps', 'elbow extensor'], color: '#3b82f6' },
  { id: 'forearm', label: 'Wrist / finger', keys: ['wrist', 'extensor carpi', 'flexor carpi', 'finger', 'digitorum', 'grip', 'hand', 'intrinsic'], color: '#10b981' },
  { id: 'abs', label: 'Abdominals', keys: ['abdomin', 'rectus abdominis', 'oblique', 'core'], color: '#a855f7' },
  { id: 'back', label: 'Back extensors / lats', keys: ['erector', 'paraspinal', 'latissimus', 'quadratus', 'back extensor'], color: '#a855f7' },
  { id: 'hipflex', label: 'Hip flexors', keys: ['iliopsoas', 'psoas', 'iliacus', 'hip flexor', 'sartorius', 'rectus femoris'], color: '#f59e0b' },
  { id: 'adductor', label: 'Hip adductors', keys: ['adductor', 'gracilis', 'pectineus'], color: '#f59e0b' },
  { id: 'glute', label: 'Gluteals / abductors', keys: ['glute', 'tensor fasciae', 'tfl', 'hip abductor', 'hip extensor'], color: '#f59e0b' },
  { id: 'quad', label: 'Quadriceps', keys: ['quadricep', 'vastus', 'knee extensor', 'rectus femoris'], color: '#f59e0b' },
  { id: 'hamstring', label: 'Hamstrings', keys: ['hamstring', 'biceps femoris', 'semitendinosus', 'semimembranosus', 'knee flexor'], color: '#f59e0b' },
  { id: 'tibant', label: 'Ankle dorsiflexors', keys: ['tibialis anterior', 'dorsiflexor', 'extensor hallucis', 'ehl', 'toe extensor'], color: '#ef4444' },
  { id: 'calf', label: 'Calf / plantarflexors', keys: ['gastrocnemius', 'soleus', 'plantarflexor', 'plantar flexor', 'calf', 'triceps surae'], color: '#ef4444' },
];

export const MuscleVisualizer: React.FC<MuscleVisualizerProps> = ({ activeMuscles }) => {
  const text = activeMuscles.map((m) => m.toLowerCase());
  const on = (id: string) => {
    const r = REGIONS.find((x) => x.id === id)!;
    return text.some((m) => r.keys.some((k) => m.includes(k)));
  };
  const fill = (id: string) => (on(id) ? REGIONS.find((x) => x.id === id)!.color : '#1e293b');
  const both = (id: string, shapes: (x: (n: number) => number) => React.ReactNode) => (
    <g fill={fill(id)} className="transition-colors duration-300">
      {shapes((n) => n)}
      {shapes((n) => 100 - n)}
    </g>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center">
      <h3 className="text-sm font-semibold text-slate-300 mb-3 self-start">Likely muscle groups (front view)</h3>
      <div className="w-56 h-96 bg-slate-950/40 rounded-xl border border-slate-800 flex items-center justify-center p-2">
        <svg viewBox="0 0 100 230" className="h-full w-auto" role="img" aria-label="Body outline with highlighted muscle groups">
          <circle cx="50" cy="16" r="11" fill="#334155" />
          {both('neck', (x) => <path d={`M${x(44)} 27 L${x(36)} 38 L${x(46)} 36 Z`} />)}
          {both('deltoid', (x) => <circle cx={x(31)} cy="43" r="7" />)}
          {both('pec', (x) => <rect x={Math.min(x(38), x(49))} y="38" width="11" height="13" rx="3" />)}
          <g fill={fill('back')}>
            <rect x="38" y="52" width="24" height="4" rx="1" opacity="0.7" />
          </g>
          <g fill={fill('abs')}>
            <rect x="40" y="57" width="20" height="30" rx="3" />
          </g>
          {both('biceps', (x) => <rect x={Math.min(x(24), x(31))} y="51" width="7" height="22" rx="3.5" />)}
          {both('triceps', (x) => <rect x={Math.min(x(21), x(24))} y="53" width="3" height="18" rx="1.5" />)}
          {both('forearm', (x) => <rect x={Math.min(x(21), x(27))} y="76" width="6" height="26" rx="3" />)}
          {both('glute', (x) => <circle cx={x(37)} cy="92" r="5" />)}
          {both('hipflex', (x) => <path d={`M${x(42)} 88 L${x(49)} 92 L${x(46)} 104 Z`} />)}
          {both('quad', (x) => <rect x={Math.min(x(37), x(46))} y="100" width="9" height="42" rx="4" />)}
          {both('adductor', (x) => <rect x={Math.min(x(46), x(49))} y="104" width="3" height="26" rx="1.5" />)}
          {both('hamstring', (x) => <rect x={Math.min(x(35), x(37))} y="106" width="2" height="34" rx="1" />)}
          {both('tibant', (x) => <rect x={Math.min(x(41), x(45))} y="150" width="4" height="40" rx="2" />)}
          {both('calf', (x) => <rect x={Math.min(x(37), x(41))} y="148" width="4" height="34" rx="2" />)}
          {both('tibant', (x) => <rect x={Math.min(x(38), x(47))} y="200" width="9" height="5" rx="2" opacity="0.6" />)}
        </svg>
      </div>
      <ul className="mt-3 w-full grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {REGIONS.map((r) => (
          <li key={r.id} className={`flex items-center gap-1.5 ${on(r.id) ? 'text-white' : 'text-slate-500'}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: on(r.id) ? r.color : '#334155' }} />
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
};
