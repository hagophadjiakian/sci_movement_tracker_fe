// Mirrors MuscleAnalysisResult in the backend (schemas/movement.py).
export interface Analysis {
  primary_muscles: string[];
  secondary_muscles: string[];
  myotomes: string;
  compensation: string;
  clinical_note: string;
  confidence: 'low' | 'medium' | 'high';
  limitations: string;
}

// Mirrors schemas/session.py
export interface MovementBout {
  joint: string;
  start: number;
  end: number;
  excursion_deg: number;
  peak_speed_dps: number;
  direction: 'increase' | 'decrease';
  oscillation_hz: number | null;
  clonus_like: boolean;
  first_mover: string | null;
  lead_ms: number | null;
  axial_led: boolean;
  trunk_turn_deg: number | null;
  thigh_turn_deg: number | null;
  driver: 'thigh' | 'trunk' | 'both' | null;
}

export interface JointSummary {
  joint: string;
  visible_fraction: number;
  min_deg: number | null;
  max_deg: number | null;
  rom_deg: number | null;
  noise_deg: number | null;
  bouts: number;
}

export interface SessionResult {
  duration_s: number;
  fps: number;
  joints: JointSummary[];
  bouts: MovementBout[];
  summary: string;
  not_assessed: string[];
  ai_note: string | null;
  caveats: string[];
}

export interface SessionInfo {
  id: string;
  status: 'queued' | 'analyzing' | 'done' | 'error';
  created_at: string;
  started_at: string;
  duration_s: number;
  stop_reason: string;
  sci_level: string;
  exercise_name: string;
  error: string | null;
  result: SessionResult | null;
}

// Client-side entry: an upload in progress has no server id yet.
export interface SessionEntry {
  localId: string;
  serverId?: string;
  uploading: boolean;
  uploadError?: string;
  info?: SessionInfo;
  startedAt: string;
  durationS: number;
}
