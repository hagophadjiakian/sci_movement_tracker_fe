// Builds poses with known joint angles and checks every channel's value and sign.
// Run: npm run test:angles
import { computeAngles, HandPoints, Pt, Side, V } from '../src/lib/angles';

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sc = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V) => Math.hypot(...a);
const unit = (a: V): V => sc(a, 1 / nrm(a));
const R = (d: number) => (d * Math.PI) / 180;
// Rodrigues rotation of v about axis by deg.
const rot = (v: V, axis: V, d: number): V => {
  if (d === 0 || nrm(axis) < 1e-9) return v;
  const k = unit(axis), c = Math.cos(R(d)), s = Math.sin(R(d));
  return add(add(sc(v, c), sc(cross(k, v), s)), sc(k, dot(k, v) * (1 - c)));
};
// Rotate v toward target by d degrees.
const toward = (v: V, target: V, d: number) => rot(v, cross(v, target), d);

const LAT: V = [1, 0, 0], UP: V = [0, -1, 0], FWD: V = [0, 0, -1];

interface ArmP { shFlex?: number; shAbd?: number; shER?: number; elbow?: number; pron?: number; wFlex?: number; wRad?: number; mcp?: number; pip?: number }
interface LegP { hipFlex?: number; hipAbd?: number; hipIR?: number; knee?: number; dorsi?: number; inv?: number }
interface P {
  trunkFwd?: number; trunkRight?: number; trunkRotR?: number;
  yawR?: number; pitchDown?: number; rollR?: number; shrugL?: number;
  arm?: Partial<Record<Side, ArmP>>; leg?: Partial<Record<Side, LegP>>;
}

function build(p: P): { image: Pt[]; world: Pt[]; hands: Partial<Record<Side, HandPoints>> } {
  const W: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);
  // trunk
  let upT = rot(rot(UP, LAT, p.trunkFwd ?? 0), FWD, p.trunkRight ?? 0);
  let latT = rot(LAT, FWD, p.trunkRight ?? 0);
  latT = rot(latT, upT, -(p.trunkRotR ?? 0));
  const fwdT = cross(latT, upT);
  W[23] = [0.1, 0, 0]; W[24] = [-0.1, 0, 0];
  const midSh = sc(upT, 0.5);
  W[11] = add(add(midSh, sc(latT, 0.18)), sc(upT, (p.shrugL ?? 0) * 0.01));
  W[12] = add(midSh, sc(latT, -0.18));
  // head
  let latH = latT, upH = upT, fH = fwdT;
  const yaw = -(p.yawR ?? 0);
  latH = rot(latH, upH, yaw); fH = rot(fH, upH, yaw);
  fH = rot(fH, latH, p.pitchDown ?? 0); upH = rot(upH, latH, p.pitchDown ?? 0);
  latH = rot(latH, fH, p.rollR ?? 0); upH = rot(upH, fH, p.rollR ?? 0);
  const midEar = add(midSh, sc(upT, 0.22));
  W[7] = add(midEar, sc(latH, 0.075)); W[8] = add(midEar, sc(latH, -0.075));
  W[0] = add(midEar, sc(fH, 0.1));
  const hands: Partial<Record<Side, HandPoints>> = {};
  for (const side of ['left', 'right'] as Side[]) {
    const a = p.arm?.[side] ?? {};
    const L = side === 'left';
    const [iSh, iEl, iWr, iPi, iIx, iTh] = L ? [11, 13, 15, 17, 19, 21] : [12, 14, 16, 18, 20, 22];
    const out = L ? latT : sc(latT, -1);
    const medial = sc(out, -1);
    let hum = sc(upT, -1);
    let front = fwdT;
    if (a.shAbd) { const ax = cross(hum, out); hum = rot(hum, ax, a.shAbd); front = rot(front, ax, a.shAbd); }
    if (a.shFlex) { const ax = cross(hum, fwdT); hum = rot(hum, ax, a.shFlex); front = rot(front, ax, a.shFlex); }
    if (a.shER) front = rot(front, cross(front, out), a.shER);
    const e = a.elbow ?? 0;
    const fa = add(sc(hum, Math.cos(R(e))), sc(front, Math.sin(R(e))));
    W[iEl] = add(W[iSh], sc(hum, 0.3));
    W[iWr] = add(W[iEl], sc(fa, 0.27));
    // hand frame: neutral = thumb toward the shoulder side, palm medial
    let across = e > 1 ? unit(sub(sc(hum, -1), sc(fa, dot(sc(hum, -1), fa)))) : (L ? latT : sc(latT, -1)); // straight arm: thumb forward-ish
    if (e <= 1) across = fwdT;
    let h = fa;
    let palm = L ? cross(h, across) : cross(across, h);
    if (a.pron) { const ax = cross(across, medial); across = rot(across, ax, a.pron); palm = rot(palm, ax, a.pron); }
    if (a.wFlex) { const ax = cross(h, palm); h = rot(h, ax, a.wFlex); palm = rot(palm, ax, a.wFlex); }
    if (a.wRad) { const ax = cross(h, across); h = rot(h, ax, a.wRad); across = rot(across, ax, a.wRad); }
    const w0 = W[iWr];
    const mcp = (o: number, len: number): V => add(add(w0, sc(h, len)), sc(across, o));
    const H: V[] = Array.from({ length: 21 }, () => [0, 0, 0] as V);
    H[0] = w0;
    const flexAx = cross(h, palm);
    const finger = (base: number, pos: V) => {
      H[base] = pos;
      let d = rot(h, flexAx, a.mcp ?? 0);
      H[base + 1] = add(H[base], sc(d, 0.04));
      d = rot(d, flexAx, a.pip ?? 0);
      H[base + 2] = add(H[base + 1], sc(d, 0.025));
      H[base + 3] = add(H[base + 2], sc(d, 0.02));
    };
    finger(5, mcp(0.025, 0.08)); finger(9, mcp(0, 0.08)); finger(13, mcp(-0.012, 0.078)); finger(17, mcp(-0.025, 0.075));
    const td = unit(add(h, across));
    H[1] = add(add(w0, sc(h, 0.02)), sc(across, 0.02));
    H[2] = add(H[1], sc(td, 0.04)); H[3] = add(H[2], sc(td, 0.03)); H[4] = add(H[3], sc(td, 0.025));
    W[iIx] = H[5]; W[iPi] = H[17]; W[iTh] = H[2];
    hands[side] = { image: H.map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })), world: H.map(([x, y, z]) => ({ x, y, z })) };

    // leg (pelvis = world frame)
    const g = p.leg?.[side] ?? {};
    const [iHip, iKn, iAn, iHe, iFo] = L ? [23, 25, 27, 29, 31] : [24, 26, 28, 30, 32];
    const outW = L ? LAT : sc(LAT, -1);
    let thigh = sc(UP, -1), back = sc(FWD, -1), footF = FWD;
    const turn = (ax: V, d: number) => { thigh = rot(thigh, ax, d); back = rot(back, ax, d); footF = rot(footF, ax, d); };
    if (g.hipAbd) turn(cross(thigh, outW), g.hipAbd);
    if (g.hipFlex) turn(cross(thigh, FWD), g.hipFlex);
    if (g.hipIR) { const ax = cross(back, outW); back = rot(back, ax, g.hipIR); footF = rot(footF, ax, g.hipIR); }
    // hip IR with a straight knee: turn the foot medially about the thigh
    if (g.hipIR && !(g.knee && g.knee >= 30)) { footF = rot(footF, thigh, 0); }
    const kAx = cross(thigh, back);
    const shank = rot(thigh, kAx, g.knee ?? 0);
    footF = rot(footF, kAx, g.knee ?? 0);
    footF = rot(footF, cross(footF, sc(shank, -1)), g.dorsi ?? 0);
    let fd = unit(sub(shank, sc(footF, dot(shank, footF))));
    const medW = sc(outW, -1);
    if (g.inv) fd = rot(fd, cross(fd, medW), g.inv);
    W[iKn] = add(W[iHip], sc(thigh, 0.45));
    W[iAn] = add(W[iKn], sc(shank, 0.42));
    W[iHe] = add(add(W[iAn], sc(fd, 0.05)), sc(footF, -0.05));
    W[iFo] = add(add(W[iAn], sc(fd, 0.05)), sc(footF, 0.15));
  }
  const world = W.map(([x, y, z]) => ({ x, y, z, visibility: 1 }));
  const image = W.map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  return { image, world, hands };
}

let fails = 0, checks = 0;
function check(name: string, p: P, expect: Record<string, number>, opts: { noHands?: boolean } = {}) {
  const b = build(p);
  const r = computeAngles(b.image, b.world, opts.noHands ? {} : b.hands);
  const bad: string[] = [];
  for (const [k, want] of Object.entries(expect)) {
    checks++;
    const got = r.values[k];
    if (got === null || Math.abs(got - want) > 1.5) bad.push(`${k}: got ${got}, want ${want}`);
  }
  fails += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name}${bad.length ? '\n       ' + bad.join('\n       ') : ''}`);
}

const zeroArm = { 'right.shoulder_flexion': 0, 'right.shoulder_abduction': 0, 'right.elbow_flexion': 0 };
check('neutral', {}, { ...zeroArm, 'left.knee_flexion': 0, 'left.hip_flexion': 0, 'axial.neck_rotation': 0, 'axial.neck_flexion': 0, 'axial.trunk_rotation': 0, 'axial.pelvic_obliquity': 0 });
for (const s of ['left', 'right'] as Side[]) {
  check(`${s} shoulder flexion 60`, { arm: { [s]: { shFlex: 60 } } }, { [`${s}.shoulder_flexion`]: 60 });
  check(`${s} shoulder abduction 45`, { arm: { [s]: { shAbd: 45 } } }, { [`${s}.shoulder_abduction`]: 45 });
  check(`${s} elbow 90, ER 40`, { arm: { [s]: { elbow: 90, shER: 40 } } }, { [`${s}.elbow_flexion`]: 90, [`${s}.shoulder_rotation`]: 40 });
  check(`${s} elbow 90, IR 30`, { arm: { [s]: { elbow: 90, shER: -30 } } }, { [`${s}.shoulder_rotation`]: -30 });
  check(`${s} pronation 70`, { arm: { [s]: { elbow: 90, pron: 70 } } }, { [`${s}.forearm_pronation`]: 70 });
  check(`${s} supination 60`, { arm: { [s]: { elbow: 90, pron: -60 } } }, { [`${s}.forearm_pronation`]: -60 });
  check(`${s} wrist flexion 50`, { arm: { [s]: { elbow: 90, wFlex: 50 } } }, { [`${s}.wrist_flexion`]: 50, [`${s}.wrist_radial_deviation`]: 0, [`${s}.elbow_flexion`]: 90 });
  check(`${s} wrist extension 40`, { arm: { [s]: { elbow: 90, wFlex: -40 } } }, { [`${s}.wrist_flexion`]: -40 });
  check(`${s} radial deviation 15`, { arm: { [s]: { elbow: 90, wRad: 15 } } }, { [`${s}.wrist_radial_deviation`]: 15, [`${s}.wrist_flexion`]: 0 });
  check(`${s} wrist flex 30 + pron 50`, { arm: { [s]: { elbow: 90, pron: 50, wFlex: 30 } } }, { [`${s}.wrist_flexion`]: 30, [`${s}.forearm_pronation`]: 50 });
  check(`${s} fingers MCP 60 PIP 45`, { arm: { [s]: { elbow: 90, mcp: 60, pip: 45 } } }, { [`${s}.index_mcp`]: 60, [`${s}.index_pip`]: 45, [`${s}.little_mcp`]: 60, [`${s}.index_dip`]: 0, [`${s}.wrist_flexion`]: 0 });
  check(`${s} finger hyperextension`, { arm: { [s]: { elbow: 90, mcp: -20 } } }, { [`${s}.index_mcp`]: -20 });
  check(`${s} hip flexion 40`, { leg: { [s]: { hipFlex: 40 } } }, { [`${s}.hip_flexion`]: 40, [`${s}.thigh_incl`]: 40, [`${s}.knee_flexion`]: 0 });
  check(`${s} hip abduction 20`, { leg: { [s]: { hipAbd: 20 } } }, { [`${s}.hip_abduction`]: 20 });
  check(`${s} sitting 90/90`, { leg: { [s]: { hipFlex: 90, knee: 90 } } }, { [`${s}.hip_flexion`]: 90, [`${s}.knee_flexion`]: 90, [`${s}.shank_incl`]: 0, [`${s}.hip_rotation`]: 0 });
  check(`${s} sitting, hip IR 25`, { leg: { [s]: { hipFlex: 90, knee: 90, hipIR: 25 } } }, { [`${s}.hip_rotation`]: 25 });
  check(`${s} standing knee 60, hip ER 20`, { leg: { [s]: { knee: 60, hipIR: -20 } } }, { [`${s}.hip_rotation`]: -20, [`${s}.knee_flexion`]: 60 });
  check(`${s} straight leg toes out 20`, { leg: { [s]: { hipIR: -20 } } }, { [`${s}.hip_rotation`]: -20, [`${s}.foot_progression`]: 20 });
  check(`${s} dorsiflexion 15`, { leg: { [s]: { dorsi: 15 } } }, { [`${s}.ankle_dorsiflexion`]: 15, [`${s}.ankle_inversion`]: 0 });
  check(`${s} plantarflexion 30`, { leg: { [s]: { dorsi: -30 } } }, { [`${s}.ankle_dorsiflexion`]: -30 });
  check(`${s} inversion 20`, { leg: { [s]: { inv: 20 } } }, { [`${s}.ankle_inversion`]: 20 });
}
check('trunk forward 30 (thigh still)', { trunkFwd: 30 }, { 'axial.trunk_flexion': 30, 'left.hip_flexion': 30, 'left.thigh_incl': 0, 'axial.trunk_lean': 30 });
check('trunk lean right 12', { trunkRight: 12 }, { 'axial.trunk_lateral_lean': 12 });
check('trunk rotation right 25', { trunkRotR: 25 }, { 'axial.trunk_rotation': 25 });
check('neck rotation right 40', { yawR: 40 }, { 'axial.neck_rotation': 40, 'axial.neck_flexion': 0, 'axial.neck_lateral_flexion': 0 });
check('neck flexion 30', { pitchDown: 30 }, { 'axial.neck_flexion': 30, 'axial.neck_rotation': 0 });
check('neck side bend right 20', { rollR: 20 }, { 'axial.neck_lateral_flexion': 20, 'axial.neck_rotation': 0 });
const s0 = computeAngles(build({}).image, build({}).world).values['left.shoulder_elevation']!;
const s1 = computeAngles(build({ shrugL: 3 }).image, build({ shrugL: 3 }).world).values['left.shoulder_elevation']!;
checks++; if (!(s1 > s0)) { fails++; console.log(`FAIL left shrug raises elevation (${s0} -> ${s1})`); } else console.log(`ok   left shrug 3 cm: elevation ${s0}% -> ${s1}%`);
check('pose-only wrist flexion 40 (no hand model)', { arm: { right: { elbow: 90, wFlex: 40 } } }, { 'right.wrist_flexion': 40 }, { noHands: true });

// hips out of the picture: trunk/pelvis/legs must be null, arms and neck still measured
{
  const b = build({ arm: { right: { shFlex: 50 } }, yawR: 20 });
  b.image[23] = { ...b.image[23], y: 1.2 }; b.image[24] = { ...b.image[24], y: 1.2 };
  const r = computeAngles(b.image, b.world, b.hands);
  const ok = r.meta.frame === 'shoulders' && r.values['axial.trunk_flexion'] === null && r.values['axial.pelvic_obliquity'] === null
    && r.values['left.hip_flexion'] === null && Math.abs((r.values['right.shoulder_flexion'] ?? 0) - 50) < 1.5
    && Math.abs((r.values['axial.neck_rotation'] ?? 0) - 20) < 1.5;
  checks++; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} hips hidden -> frame=${r.meta.frame}, trunk=${r.values['axial.trunk_flexion']}, shoulder=${r.values['right.shoulder_flexion']}, neck rot=${r.values['axial.neck_rotation']}`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
