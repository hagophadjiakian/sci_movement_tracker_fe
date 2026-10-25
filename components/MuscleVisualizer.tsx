import React from 'react';

interface MuscleVisualizerProps {
  activeMuscles: string[];
}

export const MuscleVisualizer: React.FC<MuscleVisualizerProps> = ({ activeMuscles }) => {
  const isHighlighted = (muscleName: string) => {
    return activeMuscles.some((m) => m.toLowerCase().includes(muscleName.toLowerCase()));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col items-center">
      <h3 className="text-sm font-semibold text-slate-300 mb-3 self-start">Active Muscle Heatmap</h3>
      
      {/* Simplified anatomical outline SVG */}
      <div className="relative w-48 h-64 bg-slate-950/40 rounded-xl border border-slate-800 flex items-center justify-center p-2">
        <svg viewBox="0 0 100 200" className="h-full w-auto">
          {/* Head & Neck */}
          <circle cx="50" cy="20" r="12" fill="#334155" />
          <rect x="46" y="32" width="8" height="8" fill="#334155" />

          {/* Deltoids */}
          <circle 
            cx="32" cy="48" r="8" 
            fill={isHighlighted('deltoid') ? '#3b82f6' : '#1e293b'} 
            className="transition-colors duration-300"
          />
          <circle 
            cx="68" cy="48" r="8" 
            fill={isHighlighted('deltoid') ? '#3b82f6' : '#1e293b'} 
            className="transition-colors duration-300"
          />

          {/* Biceps / Arms */}
          <rect 
            x="24" y="58" width="8" height="25" rx="4"
            fill={isHighlighted('biceps') ? '#3b82f6' : '#1e293b'}
            className="transition-colors duration-300"
          />
          <rect 
            x="68" y="58" width="8" height="25" rx="4"
            fill={isHighlighted('biceps') ? '#3b82f6' : '#1e293b'}
            className="transition-colors duration-300"
          />

          {/* Core / Trunk */}
          <rect x="38" y="45" width="24" height="45" rx="4" fill="#1e293b" />

          {/* Forearm / Wrists */}
          <rect 
            x="24" y="86" width="6" height="22" rx="3"
            fill={isHighlighted('extensor') || isHighlighted('flexor') ? '#10b981' : '#1e293b'}
            className="transition-colors duration-300"
          />
          <rect 
            x="70" y="86" width="6" height="22" rx="3"
            fill={isHighlighted('extensor') || isHighlighted('flexor') ? '#10b981' : '#1e293b'}
            className="transition-colors duration-300"
          />

          {/* Legs */}
          <rect x="41" y="94" width="8" height="50" rx="3" fill="#1e293b" />
          <rect x="51" y="94" width="8" height="50" rx="3" fill="#1e293b" />
        </svg>
      </div>

      <div className="flex gap-4 mt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Upper Body</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Forearm/Grip</span>
      </div>
    </div>
  );
};