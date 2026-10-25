import { LiveDetector } from '../src/lib/liveDetector';

let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const noise = (sd: number) => rnd() * sd * 3.4;

function run(sens: 'low' | 'medium' | 'high', amp: number, rise: number) {
  const d = new LiveDetector(sens);
  let detectedAt: number | null = null;
  for (let i = 0; i < 30 * 20; i++) {
    const t = i / 30;
    const up = Math.min(1, Math.max(0, (t - 8) / rise));
    const down = Math.min(1, Math.max(0, (t - 8 - rise - 2) / rise));
    const v = 10 + noise(0.4) + amp * (up - down);
    const m = d.update(t, { 'left.hip_flexion': v, 'left.knee_flexion': 20 + noise(0.4) });
    if (m.some((x) => x.channel === 'left.knee_flexion')) fail(`${sens}: still knee flagged at ${t.toFixed(1)}s`);
    if (detectedAt === null && m.some((x) => x.channel === 'left.hip_flexion')) detectedAt = t;
  }
  return { detectedAt, events: d.events };
}

const slowHigh = run('high', 4, 2.5);
if (slowHigh.detectedAt === null || slowHigh.detectedAt < 8) fail('slow 4° lift not caught on high');
const slowLow = run('low', 4, 2.5);
if (slowLow.detectedAt !== null) fail('slow 4° lift should be ignored on low');
const fast = run('medium', 30, 0.5);
if (fast.detectedAt === null || fast.detectedAt > 8.5) fail(`fast lift detected late: ${fast.detectedAt}`);
if (!fast.events.some((e) => e.channel === 'left.hip_flexion' && Math.abs(e.excursion - 30) <= 3)) fail('event size wrong');
// lying down: segment near +/-180 must not trigger
{
  const d = new LiveDetector('high');
  for (let i = 0; i < 300; i++) {
    const raw = 179 + noise(1);
    const v = ((raw + 180) % 360) - 180;
    if (d.update(i / 30, { 'left.shank_incl': v }).length) { fail('wrap at 180 flagged as movement'); break; }
  }
}
console.log(fails ? `${fails} live-detector checks failed` : `live detector: 6/6 checks passed (slow lift caught at ${slowHigh.detectedAt?.toFixed(2)} s)`);
if (fails) process.exit(1);
