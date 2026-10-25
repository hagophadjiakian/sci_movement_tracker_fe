// Full-body joint and segment angles from MediaPipe Pose world landmarks.
//
// Joint angles are relative between two segments (e.g. hip = thigh relative to trunk).
// Segment angles are one segment relative to vertical (e.g. trunk lean, thigh inclination).
// Comparing them shows whether a hip angle changed because the thigh moved or because the trunk did.
// Vertical comes from the camera's "down" axis, so keep the camera level.

export interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type Side = 'left' | 'right';

export const SIDE_JOINTS = [
  'shoulder_flexion',
  'shoulder_abduction',
  'elbow_flexion',
  'wrist_deviation',
  'hip_flexion',
  'hip_abduction',
  'knee_flexion',
  'ankle_dorsiflexion',
  'thigh_incl',
  'shank_incl',
] as const;
export const AXIAL_JOINTS = [
  'neck_flexion',
  'trunk_flexion',
  'trunk_lean',
  'trunk_lateral_lean',
  'pelvic_obliquity',
] as const;

export type SideJoint = (typeof SIDE_JOINTS)[number];
export type AxialJoint = (typeof AXIAL_JOINTS)[number];
export type SideAngles = Record<SideJoint, number | null>;
export type AxialAngles = Record<AxialJoint, number | null>;
export interface BodyAngles {
  left: SideAngles;
  right: SideAngles;
  axial: AxialAngles;
}

export const JOINT_LABELS: Record<SideJoint | AxialJoint, string> = {
  shoulder_flexion: 'Shoulder flexion',
  shoulder_abduction: 'Shoulder abduction',
  elbow_flexion: 'Elbow flexion',
  wrist_deviation: 'Wrist deviation',
  hip_flexion: 'Hip flexion',
  hip_abduction: 'Hip abduction',
  knee_flexion: 'Knee flexion',
  ankle_dorsiflexion: 'Ankle dorsiflexion',
  thigh_incl: 'Thigh vs vertical',
  shank_incl: 'Shank vs vertical',
  neck_flexion: 'Neck flexion',
  trunk_flexion: 'Trunk forward lean',
  trunk_lean: 'Trunk tilt (any direction)',
  trunk_lateral_lean: 'Trunk side lean (+R)',
  pelvic_obliquity: 'Pelvic obliquity (+R high)',
};

// MediaPipe Pose indices ("left"/"right" are the person's own sides).
export const LM = {
  nose: 0,
  left: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 },
  right: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 },
} as const;

const MIN_VIS = 0.5;
type V = [number, number, number];
const v = (p: Pt): V => [p.x, p.y, p.z];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V | null => {
  const n = norm(a);
  return n < 1e-9 ? null : scale(a, 1 / n);
};
const mid = (a: V, b: V): V => scale(add(a, b), 0.5);
const deg = (r: number) => (r * 180) / Math.PI;
const round1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

const angleBetween = (a: V, b: V): number | null => {
  const n = norm(a) * norm(b);
  if (n < 1e-12) return null;
  return deg(Math.acos(Math.min(1, Math.max(-1, dot(a, b) / n))));
};

interface Frame {
  up: V;
  fwd: V;
  lat: V; // toward the person's left
}

// Body frame from hips and shoulders. MediaPipe world: x = person's left (facing camera), y = down.
function bodyFrame(w: Pt[]): Frame | null {
  const hipL = v(w[LM.left.hip]);
  const hipR = v(w[LM.right.hip]);
  const shL = v(w[LM.left.shoulder]);
  const shR = v(w[LM.right.shoulder]);
  const up = unit(sub(mid(shL, shR), mid(hipL, hipR)));
  const latRaw = unit(sub(add(hipL, shL), add(hipR, shR)));
  if (!up || !latRaw) return null;
  const lat = unit(sub(latRaw, scale(up, dot(latRaw, up))));
  if (!lat) return null;
  return { up, lat, fwd: cross(lat, up) };
}

// Same idea but with vertical from gravity (camera "up" = -y) instead of the trunk.
function worldFrame(body: Frame): Frame | null {
  const up: V = [0, -1, 0];
  const fwd = unit(sub(body.fwd, scale(up, dot(body.fwd, up))));
  if (!fwd) return null;
  return { up, fwd, lat: cross(up, fwd) };
}

// Signed angle of a "hanging" segment (pointing down at 0) in the frame's sagittal plane; + = forward.
const sagittal = (seg: V, f: Frame) => deg(Math.atan2(dot(seg, f.fwd), -dot(seg, f.up)));
// Same, frontal plane; + = toward `outward`.
const frontal = (seg: V, f: Frame, outward: V) => deg(Math.atan2(dot(seg, outward), -dot(seg, f.up)));

export function emptyAngles(): BodyAngles {
  const side = () => Object.fromEntries(SIDE_JOINTS.map((k) => [k, null])) as SideAngles;
  return { left: side(), right: side(), axial: Object.fromEntries(AXIAL_JOINTS.map((k) => [k, null])) as AxialAngles };
}

export function computeBodyAngles(image: Pt[], world: Pt[]): BodyAngles {
  const out = emptyAngles();
  const seen = (...idx: number[]) => idx.every((i) => (image[i]?.visibility ?? 0) >= MIN_VIS);
  const W = (i: number) => v(world[i]);

  const torsoVisible = seen(LM.left.hip, LM.right.hip, LM.left.shoulder, LM.right.shoulder);
  const body = torsoVisible ? bodyFrame(world) : null;
  const glob = body ? worldFrame(body) : null;

  for (const side of ['left', 'right'] as Side[]) {
    const ix = LM[side];
    const o = out[side];
    const outward: V | null = body ? (side === 'left' ? body.lat : scale(body.lat, -1)) : null;

    if (body && outward && seen(ix.shoulder, ix.elbow)) {
      const arm = sub(W(ix.elbow), W(ix.shoulder));
      o.shoulder_flexion = sagittal(arm, body);
      o.shoulder_abduction = frontal(arm, body, outward);
    }
    if (seen(ix.shoulder, ix.elbow, ix.wrist)) {
      const a = angleBetween(sub(W(ix.shoulder), W(ix.elbow)), sub(W(ix.wrist), W(ix.elbow)));
      o.elbow_flexion = a === null ? null : 180 - a;
    }
    if (seen(ix.elbow, ix.wrist, ix.pinky, ix.index)) {
      const hand = mid(W(ix.pinky), W(ix.index));
      const a = angleBetween(sub(W(ix.elbow), W(ix.wrist)), sub(hand, W(ix.wrist)));
      o.wrist_deviation = a === null ? null : 180 - a;
    }
    if (seen(ix.hip, ix.knee)) {
      const thigh = sub(W(ix.knee), W(ix.hip));
      if (body && outward) {
        o.hip_flexion = sagittal(thigh, body);
        o.hip_abduction = frontal(thigh, body, outward);
      }
      if (glob) o.thigh_incl = sagittal(thigh, glob);
    }
    if (seen(ix.hip, ix.knee, ix.ankle)) {
      const a = angleBetween(sub(W(ix.hip), W(ix.knee)), sub(W(ix.ankle), W(ix.knee)));
      o.knee_flexion = a === null ? null : 180 - a;
    }
    if (glob && seen(ix.knee, ix.ankle)) o.shank_incl = sagittal(sub(W(ix.ankle), W(ix.knee)), glob);
    if (seen(ix.knee, ix.ankle, ix.heel, ix.foot)) {
      const a = angleBetween(sub(W(ix.knee), W(ix.ankle)), sub(W(ix.foot), W(ix.heel)));
      o.ankle_dorsiflexion = a === null ? null : 90 - a;
    }
    for (const k of SIDE_JOINTS) o[k] = round1(o[k]);
  }

  const ax = out.axial;
  if (body && glob) {
    // Trunk "hangs" from shoulders to hips, so flip `up` to reuse the hanging-segment helpers.
    const trunkDown = scale(body.up, -1);
    ax.trunk_flexion = -sagittal(trunkDown, glob) || 0;
    ax.trunk_lean = angleBetween(body.up, glob.up);
    ax.trunk_lateral_lean = -frontal(trunkDown, glob, scale(glob.lat, -1)) || 0;
    const hipL = W(LM.left.hip);
    const hipR = W(LM.right.hip);
    const across = sub(hipL, hipR);
    ax.pelvic_obliquity = deg(Math.atan2(dot(across, scale(glob.up, -1)), Math.hypot(dot(across, glob.fwd), dot(across, glob.lat))));
    if (seen(LM.left.ear, LM.right.ear)) {
      const neck = sub(mid(W(LM.left.ear), W(LM.right.ear)), mid(W(LM.left.shoulder), W(LM.right.shoulder)));
      ax.neck_flexion = deg(Math.atan2(dot(neck, body.fwd), dot(neck, body.up)));
    }
  }
  for (const k of AXIAL_JOINTS) ax[k] = round1(ax[k]);
  return out;
}

// Flatten to "left.knee_flexion" style channel names for recording.
export function flatten(a: BodyAngles): Record<string, number | null> {
  const r: Record<string, number | null> = {};
  for (const s of ['left', 'right'] as Side[]) for (const k of SIDE_JOINTS) r[`${s}.${k}`] = a[s][k];
  for (const k of AXIAL_JOINTS) r[`axial.${k}`] = a.axial[k];
  return r;
}

export const SKELETON: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 19], [15, 17],
  [12, 14], [14, 16], [16, 20], [16, 18],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [7, 0], [8, 0],
];
