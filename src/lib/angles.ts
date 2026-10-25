// Joint and segment angles for the whole body, hands and fingers.
//
// Inputs: MediaPipe Pose (33 points) and, when found, MediaPipe Hand (21 points per hand).
// All 3D math uses "world" landmarks (metric, camera-aligned axes: x = image right, y = down).
//
// Two kinds of angles:
//  - joint angles: one segment relative to the next (hip = thigh relative to trunk)
//  - segment angles: one segment relative to vertical (thigh vs vertical, trunk lean)
// Comparing them tells whether a hip angle changed because the thigh moved or the trunk did.
//
// Reference frames:
//  - "trunk" frame from both shoulders and both hips (needs the hips really in the picture)
//  - "shoulders" fallback when the hips are hidden: shoulder line + camera vertical.
//    Arms, hands, neck and shoulder girdle still work at a desk; hips, trunk and pelvis do not.
// Every channel is null when the points it needs are not visible. Nothing is guessed.

export interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type Side = 'left' | 'right';
export type Unit = 'deg' | '%';
export type Reliability = 'good' | 'fair' | 'low';

export interface ChannelDef {
  key: string; // without side prefix
  label: string;
  group: string;
  unit: Unit;
  reliability: Reliability;
  sign?: string; // meaning of + values
  zeroable?: boolean; // no anatomical zero: use "Set neutral"
}

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
export type Finger = (typeof FINGERS)[number];
export const FINGER_JOINTS: Record<Finger, [string, string, string]> = {
  thumb: ['cmc', 'mcp', 'ip'],
  index: ['mcp', 'pip', 'dip'],
  middle: ['mcp', 'pip', 'dip'],
  ring: ['mcp', 'pip', 'dip'],
  little: ['mcp', 'pip', 'dip'],
};

const fingerDefs: ChannelDef[] = FINGERS.flatMap((f) =>
  FINGER_JOINTS[f].map((j) => ({
    key: `${f}_${j}`,
    label: `${f[0].toUpperCase()}${f.slice(1)} ${j.toUpperCase()}`,
    group: 'Fingers',
    unit: 'deg' as Unit,
    reliability: (f === 'thumb' ? 'low' : 'fair') as Reliability,
    sign: f === 'thumb' ? 'bend (unsigned)' : '+ flexion / − hyperextension',
  })),
);

export const SIDE_CHANNELS: ChannelDef[] = [
  { key: 'shoulder_elevation', label: 'Shoulder shrug', group: 'Shoulder girdle', unit: '%', reliability: 'fair', sign: '+ up (set neutral first)', zeroable: true },
  { key: 'shoulder_protraction', label: 'Shoulder protraction', group: 'Shoulder girdle', unit: 'deg', reliability: 'low', sign: '+ forward', zeroable: true },
  { key: 'shoulder_flexion', label: 'Shoulder flexion', group: 'Shoulder', unit: 'deg', reliability: 'good', sign: '+ forward / − back' },
  { key: 'shoulder_abduction', label: 'Shoulder abduction', group: 'Shoulder', unit: 'deg', reliability: 'good', sign: '+ out / − across' },
  { key: 'shoulder_rotation', label: 'Shoulder rotation', group: 'Shoulder', unit: 'deg', reliability: 'fair', sign: '+ external (elbow bent ≥30°)' },
  { key: 'elbow_flexion', label: 'Elbow flexion', group: 'Elbow & forearm', unit: 'deg', reliability: 'good', sign: '0 = straight' },
  { key: 'forearm_pronation', label: 'Forearm pronation', group: 'Elbow & forearm', unit: 'deg', reliability: 'fair', sign: '+ palm down / − palm up (elbow bent ≥30°)' },
  { key: 'wrist_flexion', label: 'Wrist flexion', group: 'Wrist', unit: 'deg', reliability: 'fair', sign: '+ flexion / − extension' },
  { key: 'wrist_radial_deviation', label: 'Wrist deviation', group: 'Wrist', unit: 'deg', reliability: 'low', sign: '+ radial / − ulnar' },
  ...fingerDefs,
  { key: 'thumb_abduction', label: 'Thumb abduction', group: 'Fingers', unit: 'deg', reliability: 'low', sign: 'thumb–index metacarpal angle' },
  { key: 'spread_index_middle', label: 'Spread index–middle', group: 'Fingers', unit: 'deg', reliability: 'low' },
  { key: 'spread_middle_ring', label: 'Spread middle–ring', group: 'Fingers', unit: 'deg', reliability: 'low' },
  { key: 'spread_ring_little', label: 'Spread ring–little', group: 'Fingers', unit: 'deg', reliability: 'low' },
  { key: 'pinch_aperture', label: 'Pinch opening', group: 'Fingers', unit: '%', reliability: 'fair', sign: 'thumb–index tip gap, % of hand length' },
  { key: 'hip_flexion', label: 'Hip flexion', group: 'Hip', unit: 'deg', reliability: 'good', sign: '+ forward / − back (vs trunk)' },
  { key: 'hip_abduction', label: 'Hip abduction', group: 'Hip', unit: 'deg', reliability: 'fair', sign: '+ out / − across' },
  { key: 'hip_rotation', label: 'Hip rotation', group: 'Hip', unit: 'deg', reliability: 'low', sign: '+ internal / − external' },
  { key: 'knee_flexion', label: 'Knee flexion', group: 'Knee', unit: 'deg', reliability: 'good', sign: '0 = straight' },
  { key: 'ankle_dorsiflexion', label: 'Ankle dorsiflexion', group: 'Ankle & foot', unit: 'deg', reliability: 'fair', sign: '+ up / − pointed' },
  { key: 'ankle_inversion', label: 'Ankle inversion', group: 'Ankle & foot', unit: 'deg', reliability: 'low', sign: '+ sole in / − sole out' },
  { key: 'foot_progression', label: 'Foot progression', group: 'Ankle & foot', unit: 'deg', reliability: 'fair', sign: '+ toes out / − toes in' },
  { key: 'thigh_incl', label: 'Thigh vs vertical', group: 'Segments', unit: 'deg', reliability: 'good', sign: '+ forward' },
  { key: 'shank_incl', label: 'Shank vs vertical', group: 'Segments', unit: 'deg', reliability: 'good', sign: '+ forward' },
];

export const AXIAL_CHANNELS: ChannelDef[] = [
  { key: 'neck_flexion', label: 'Neck flexion', group: 'Head & neck', unit: 'deg', reliability: 'fair', sign: '+ chin down', zeroable: true },
  { key: 'neck_lateral_flexion', label: 'Neck side bend', group: 'Head & neck', unit: 'deg', reliability: 'fair', sign: '+ to the right', zeroable: true },
  { key: 'neck_rotation', label: 'Neck rotation', group: 'Head & neck', unit: 'deg', reliability: 'fair', sign: '+ to the right', zeroable: true },
  { key: 'trunk_flexion', label: 'Trunk forward lean', group: 'Trunk & pelvis', unit: 'deg', reliability: 'fair', sign: '+ forward (vs vertical)' },
  { key: 'trunk_lean', label: 'Trunk tilt (any direction)', group: 'Trunk & pelvis', unit: 'deg', reliability: 'fair' },
  { key: 'trunk_lateral_lean', label: 'Trunk side lean', group: 'Trunk & pelvis', unit: 'deg', reliability: 'good', sign: '+ to the right' },
  { key: 'trunk_rotation', label: 'Trunk rotation', group: 'Trunk & pelvis', unit: 'deg', reliability: 'fair', sign: '+ shoulders turned right vs pelvis' },
  { key: 'pelvic_obliquity', label: 'Pelvic obliquity', group: 'Trunk & pelvis', unit: 'deg', reliability: 'fair', sign: '+ right hip higher' },
  { key: 'pelvic_rotation', label: 'Pelvis rotation', group: 'Trunk & pelvis', unit: 'deg', reliability: 'low', sign: '+ turned right (vs camera)' },
];

export const SIDES: Side[] = ['left', 'right'];
export const ALL_CHANNELS: string[] = [
  ...SIDES.flatMap((s) => SIDE_CHANNELS.map((c) => `${s}.${c.key}`)),
  ...AXIAL_CHANNELS.map((c) => `axial.${c.key}`),
];
export const ZEROABLE = new Set<string>([
  ...SIDES.flatMap((s) => SIDE_CHANNELS.filter((c) => c.zeroable).map((c) => `${s}.${c.key}`)),
  ...AXIAL_CHANNELS.filter((c) => c.zeroable).map((c) => `axial.${c.key}`),
]);

// MediaPipe Pose indices ("left"/"right" are the person's own sides).
export const LM = {
  nose: 0,
  left: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, thumb: 21, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 },
  right: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, thumb: 22, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 },
} as const;

// MediaPipe Hand indices.
export const HAND = {
  wrist: 0,
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
} as const;

// ---- vector helpers ------------------------------------------------------
export type V = [number, number, number];
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
// Component of a perpendicular to axis.
const perp = (a: V, axis: V): V => {
  const u = unit(axis);
  return u ? sub(a, scale(u, dot(a, u))) : a;
};
const angleBetween = (a: V, b: V): number | null => {
  const n = norm(a) * norm(b);
  if (n < 1e-12) return null;
  return deg(Math.acos(Math.min(1, Math.max(-1, dot(a, b) / n))));
};
// Signed angle from a to b around axis (right-hand rule).
const signedAngle = (a: V, b: V, axis: V): number | null => {
  const u = unit(axis);
  if (!u || norm(a) < 1e-9 || norm(b) < 1e-9) return null;
  return deg(Math.atan2(dot(cross(a, b), u), dot(a, b)));
};

export interface Frame {
  up: V;
  fwd: V;
  lat: V; // toward the person's left
}

// Trunk frame. MediaPipe world: x = person's left when facing the camera, y = down.
function trunkFrame(w: (i: number) => V): Frame | null {
  const hipL = w(LM.left.hip);
  const hipR = w(LM.right.hip);
  const shL = w(LM.left.shoulder);
  const shR = w(LM.right.shoulder);
  const up = unit(sub(mid(shL, shR), mid(hipL, hipR)));
  const latRaw = unit(sub(add(hipL, shL), add(hipR, shR)));
  if (!up || !latRaw) return null;
  const lat = unit(perp(latRaw, up));
  if (!lat) return null;
  return { up, lat, fwd: cross(lat, up) };
}

// Fallback when hips are hidden: shoulder line + camera vertical.
function shoulderFrame(w: (i: number) => V): Frame | null {
  const up: V = [0, -1, 0];
  const lat = unit(perp(sub(w(LM.left.shoulder), w(LM.right.shoulder)), up));
  if (!lat) return null;
  return { up, lat, fwd: cross(lat, up) };
}

// Vertical from the camera, forward from the body.
function gravityFrame(body: Frame): Frame | null {
  const up: V = [0, -1, 0];
  const fwd = unit(perp(body.fwd, up));
  if (!fwd) return null;
  return { up, fwd, lat: cross(up, fwd) };
}

// Signed angle of a segment hanging down at 0, in the frame's sagittal / frontal plane.
const sagittal = (seg: V, f: Frame) => deg(Math.atan2(dot(seg, f.fwd), -dot(seg, f.up)));
const frontal = (seg: V, f: Frame, outward: V) => deg(Math.atan2(dot(seg, outward), -dot(seg, f.up)));

export interface HandPoints {
  image: Pt[];
  world: Pt[];
}

export interface AngleMeta {
  frame: 'trunk' | 'shoulders' | null;
  hand: Record<Side, 'hand' | 'pose' | null>;
  engine?: 'mediapipe' | 'rtmpose';
  dims?: '3d' | '2d';
  view?: 'side' | 'front';
  facing?: 'left' | 'right' | null;
}

export interface AngleResult {
  values: Record<string, number | null>;
  meta: AngleMeta;
}

export const MIN_VIS = 0.5;
const EDGE = 0.01;

export function isSeen(p: Pt | undefined): boolean {
  return !!p && (p.visibility ?? 0) >= MIN_VIS && p.x > EDGE && p.x < 1 - EDGE && p.y > EDGE && p.y < 1 - EDGE;
}

export function emptyValues(): Record<string, number | null> {
  return Object.fromEntries(ALL_CHANNELS.map((k) => [k, null]));
}

export function computeAngles(
  image: Pt[],
  world: Pt[],
  hands: Partial<Record<Side, HandPoints>> = {},
): AngleResult {
  const out = emptyValues();
  const meta: AngleMeta = { frame: null, hand: { left: null, right: null } };
  const seen = (...idx: number[]) => idx.every((i) => isSeen(image[i]));
  const W = (i: number) => v(world[i]);
  const set = (k: string, x: number | null | undefined) => {
    out[k] = x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
  };

  const torso = seen(LM.left.hip, LM.right.hip, LM.left.shoulder, LM.right.shoulder) ? trunkFrame(W) : null;
  const upper = torso ?? (seen(LM.left.shoulder, LM.right.shoulder) ? shoulderFrame(W) : null);
  meta.frame = torso ? 'trunk' : upper ? 'shoulders' : null;
  const tGlob = torso ? gravityFrame(torso) : null;

  for (const side of SIDES) {
    const ix = LM[side];
    const k = (name: string) => `${side}.${name}`;
    const sgn = side === 'right' ? 1 : -1;

    // ---- shoulder girdle, shoulder, elbow (need the upper frame) ----------
    if (upper) {
      const outward = side === 'left' ? upper.lat : scale(upper.lat, -1);
      const shL = W(LM.left.shoulder);
      const shR = W(LM.right.shoulder);
      const width = norm(sub(shL, shR));
      if (seen(ix.ear) && width > 1e-6) {
        // Shoulder rising toward the same-side ear. Head nodding also changes this; compare with neck flexion.
        set(k('shoulder_elevation'), (-100 * dot(sub(W(ix.ear), W(ix.shoulder)), upper.up)) / width);
      }
      const clav = sub(W(ix.shoulder), mid(shL, shR));
      set(k('shoulder_protraction'), deg(Math.atan2(dot(clav, upper.fwd), Math.abs(dot(clav, upper.lat)))));

      if (seen(ix.shoulder, ix.elbow)) {
        const arm = sub(W(ix.elbow), W(ix.shoulder));
        set(k('shoulder_flexion'), sagittal(arm, upper));
        set(k('shoulder_abduction'), frontal(arm, upper, outward));
      }
    }

    let elbowFlex: number | null = null;
    if (seen(ix.shoulder, ix.elbow, ix.wrist)) {
      const a = angleBetween(sub(W(ix.shoulder), W(ix.elbow)), sub(W(ix.wrist), W(ix.elbow)));
      elbowFlex = a === null ? null : 180 - a;
      set(k('elbow_flexion'), elbowFlex);

      const hum = sub(W(ix.elbow), W(ix.shoulder));
      const fore = sub(W(ix.wrist), W(ix.elbow));
      const humU = unit(hum);
      if (upper && humU && elbowFlex !== null && elbowFlex >= 30 && Math.abs(dot(humU, upper.fwd)) < 0.85) {
        const th = signedAngle(perp(upper.fwd, hum), perp(fore, hum), hum);
        set(k('shoulder_rotation'), th === null ? null : sgn * th);
      }
    }

    // ---- hand: prefer the hand model, else the 3 pose hand points ---------
    const hand = hands[side];
    let hW: V | null = null, hIndex: V | null = null, hMiddle: V | null = null, hPinky: V | null = null;
    if (hand && hand.world.length >= 21) {
      const H = (i: number) => v(hand.world[i]);
      hW = H(HAND.wrist);
      hIndex = H(HAND.index[0]);
      hMiddle = H(HAND.middle[0]);
      hPinky = H(HAND.little[0]);
      meta.hand[side] = 'hand';
    } else if (seen(ix.wrist, ix.index, ix.pinky)) {
      hW = W(ix.wrist);
      hIndex = W(ix.index);
      hPinky = W(ix.pinky);
      hMiddle = mid(hIndex, hPinky);
      meta.hand[side] = 'pose';
    }

    if (hW && hIndex && hMiddle && hPinky && seen(ix.elbow, ix.wrist)) {
      const fore = sub(W(ix.wrist), W(ix.elbow));
      const fU = unit(fore);
      const h = sub(hMiddle, hW);
      // Toward the thumb (radial) side. The index knuckle sits further down the hand than the little
      // finger knuckle, so remove the along-the-hand part or wrist flexion leaks into pronation.
      const across = perp(sub(hIndex, hPinky), h);
      const n = cross(sub(hIndex, hW), sub(hPinky, hW));
      const palmar = side === 'right' ? n : scale(n, -1);
      if (fU) {
        const pP = unit(perp(palmar, fU));
        if (pP) {
          set(k('wrist_flexion'), deg(Math.atan2(dot(h, pP), dot(h, fU))));
          const rad = unit(perp(perp(across, fU), pP));
          if (rad) set(k('wrist_radial_deviation'), deg(Math.atan2(dot(h, rad), dot(h, fU))));
        }
        if (elbowFlex !== null && elbowFlex >= 30 && seen(ix.shoulder)) {
          const ref = perp(sub(W(ix.shoulder), W(ix.elbow)), fU);
          const th = signedAngle(ref, perp(across, fU), fU);
          set(k('forearm_pronation'), th === null ? null : -sgn * th);
        }
      }
    }

    // ---- fingers (hand model only) ----------------------------------------
    if (hand && hand.world.length >= 21) {
      const H = (i: number) => v(hand.world[i]);
      const wrist = H(HAND.wrist);
      const across = perp(sub(H(HAND.index[0]), H(HAND.little[0])), sub(H(HAND.middle[0]), wrist));
      const flexAxis = side === 'right' ? across : scale(across, -1);
      const n = cross(sub(H(HAND.index[0]), wrist), sub(H(HAND.little[0]), wrist));
      const palmar = side === 'right' ? n : scale(n, -1);
      for (const f of FINGERS) {
        const [a, b, c, d] = HAND[f];
        const segs: V[] = [sub(H(a), wrist), sub(H(b), H(a)), sub(H(c), H(b)), sub(H(d), H(c))];
        const names = FINGER_JOINTS[f];
        for (let j = 0; j < 3; j++) {
          const val = f === 'thumb' ? angleBetween(segs[j], segs[j + 1]) : signedAngle(segs[j], segs[j + 1], flexAxis);
          set(k(`${f}_${names[j]}`), val);
        }
      }
      set(k('thumb_abduction'), angleBetween(sub(H(HAND.thumb[1]), H(HAND.thumb[0])), sub(H(HAND.index[0]), wrist)));
      const prox = (f: Finger) => perp(sub(H(HAND[f][1]), H(HAND[f][0])), palmar);
      set(k('spread_index_middle'), angleBetween(prox('index'), prox('middle')));
      set(k('spread_middle_ring'), angleBetween(prox('middle'), prox('ring')));
      set(k('spread_ring_little'), angleBetween(prox('ring'), prox('little')));
      const handLen = norm(sub(H(HAND.middle[0]), wrist));
      if (handLen > 1e-6) set(k('pinch_aperture'), (100 * norm(sub(H(HAND.thumb[3]), H(HAND.index[3])))) / handLen);
    }

    // ---- lower limb (needs the real trunk frame) ---------------------------
    if (torso && tGlob) {
      const outward = side === 'left' ? torso.lat : scale(torso.lat, -1);
      if (seen(ix.hip, ix.knee)) {
        const thigh = sub(W(ix.knee), W(ix.hip));
        set(k('hip_flexion'), sagittal(thigh, torso));
        set(k('hip_abduction'), frontal(thigh, torso, outward));
        set(k('thigh_incl'), sagittal(thigh, tGlob));

        let kneeFlex: number | null = null;
        if (seen(ix.ankle)) {
          const a = angleBetween(sub(W(ix.hip), W(ix.knee)), sub(W(ix.ankle), W(ix.knee)));
          kneeFlex = a === null ? null : 180 - a;
          set(k('knee_flexion'), kneeFlex);
        }
        // Hip rotation: shank around the thigh when the knee is bent, else the foot.
        if (kneeFlex !== null && kneeFlex >= 30) {
          const ref = perp(add(scale(torso.up, -1), scale(torso.fwd, -1)), thigh);
          const th = signedAngle(ref, perp(sub(W(ix.ankle), W(ix.knee)), thigh), thigh);
          set(k('hip_rotation'), th === null ? null : -sgn * th);
        } else if (kneeFlex !== null && seen(ix.heel, ix.foot)) {
          const ref = perp(add(torso.fwd, torso.up), thigh);
          const th = signedAngle(ref, perp(sub(W(ix.foot), W(ix.heel)), thigh), thigh);
          set(k('hip_rotation'), th === null ? null : -sgn * th);
        }
      }
      if (seen(ix.knee, ix.ankle)) set(k('shank_incl'), sagittal(sub(W(ix.ankle), W(ix.knee)), tGlob));
      if (seen(ix.knee, ix.ankle, ix.heel, ix.foot)) {
        const shankUp = sub(W(ix.knee), W(ix.ankle));
        const footV = sub(W(ix.foot), W(ix.heel));
        const a = angleBetween(shankUp, footV);
        set(k('ankle_dorsiflexion'), a === null ? null : 90 - a);

        let nf = unit(cross(footV, sub(W(ix.ankle), W(ix.heel))));
        const sU = unit(shankUp);
        if (nf && sU) {
          if (dot(nf, outward) < 0) nf = scale(nf, -1);
          const latRef = unit(perp(outward, sU));
          if (latRef) set(k('ankle_inversion'), deg(Math.atan2(-dot(nf, sU), dot(nf, latRef))));
        }
        const fh = perp(footV, tGlob.up);
        const gOut = side === 'left' ? tGlob.lat : scale(tGlob.lat, -1);
        set(k('foot_progression'), deg(Math.atan2(dot(fh, gOut), dot(fh, tGlob.fwd))));
      }
    }
  }

  // ---- head & neck (upper frame) -------------------------------------------
  if (upper && seen(LM.left.ear, LM.right.ear, LM.nose)) {
    const earL = W(LM.left.ear);
    const earR = W(LM.right.ear);
    const latH = unit(sub(earL, earR));
    const fH = latH ? unit(perp(sub(W(LM.nose), mid(earL, earR)), latH)) : null;
    if (latH && fH) {
      set('axial.neck_rotation', deg(Math.atan2(-dot(fH, upper.lat), dot(fH, upper.fwd))));
      set('axial.neck_flexion', deg(Math.atan2(-dot(fH, upper.up), Math.hypot(dot(fH, upper.fwd), dot(fH, upper.lat)))));
      set('axial.neck_lateral_flexion', deg(Math.atan2(dot(latH, upper.up), Math.hypot(dot(latH, upper.lat), dot(latH, upper.fwd)))));
    }
  }

  // ---- trunk & pelvis (real trunk frame only) --------------------------------
  if (torso && tGlob) {
    const down = scale(torso.up, -1);
    set('axial.trunk_flexion', -sagittal(down, tGlob));
    set('axial.trunk_lean', angleBetween(torso.up, tGlob.up));
    set('axial.trunk_lateral_lean', -frontal(down, tGlob, scale(tGlob.lat, -1)));
    const hipLine = sub(W(LM.left.hip), W(LM.right.hip));
    const shLine = sub(W(LM.left.shoulder), W(LM.right.shoulder));
    const tr = signedAngle(perp(hipLine, torso.up), perp(shLine, torso.up), torso.up);
    set('axial.trunk_rotation', tr === null ? null : -tr);
    set(
      'axial.pelvic_obliquity',
      deg(Math.atan2(dot(hipLine, scale(tGlob.up, -1)), Math.hypot(dot(hipLine, tGlob.fwd), dot(hipLine, tGlob.lat)))),
    );
    set('axial.pelvic_rotation', deg(Math.atan2(-hipLine[2], hipLine[0])));
  }

  return { values: out, meta };
}

export const POSE_SKELETON: { a: number; b: number; side: Side | 'mid' }[] = [
  ...[[11, 12], [23, 24], [7, 0], [8, 0]].map(([a, b]) => ({ a, b, side: 'mid' as const })),
  ...[[11, 23], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31]].map(
    ([a, b]) => ({ a, b, side: 'left' as const }),
  ),
  ...[[12, 24], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]].map(
    ([a, b]) => ({ a, b, side: 'right' as const }),
  ),
];

export const HAND_SKELETON: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
