// Replays real landmarks (from a video) through the app's own angle code and left/right fix,
// producing a session upload JSON for the backend analysis. Used for real-video regression tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { computeAngles, HandPoints, isSeen, Pt, Side } from '../src/lib/angles';
import { SideTracker } from '../src/lib/sideTracker';

const [, , inPath, outPath] = process.argv;
const data = JSON.parse(readFileSync(inPath, 'utf8'));
const toPts = (a: number[][]): Pt[] => a.map(([x, y, z, v]) => ({ x, y, z, visibility: v ?? 1 }));
const tracker = new SideTracker();
const t: number[] = [];
const joints: Record<string, (number | null)[]> = {};
for (const fr of data.frames) {
  let values: Record<string, number | null> = {};
  if (fr.image) {
    const fixed = tracker.fix(toPts(fr.image), toPts(fr.world));
    const hands: Partial<Record<Side, HandPoints>> = {};
    for (const h of fr.hands ?? []) {
      const img = toPts(h.image), wld = toPts(h.world);
      let best: Side | null = null, bd = 0.15;
      for (const [s, wi] of [['left', 15], ['right', 16]] as [Side, number][]) {
        const p = fixed.image[wi];
        if (!isSeen(p) || hands[s]) continue;
        const d = Math.hypot(img[0].x - p.x, img[0].y - p.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) hands[best] = { image: img, world: wld };
    }
    values = computeAngles(fixed.image, fixed.world, hands).values;
  } else tracker.reset();
  const n = t.length;
  t.push(fr.t);
  for (const [k, v] of Object.entries(values)) {
    (joints[k] ??= new Array(n).fill(null)).push(v);
  }
  for (const arr of Object.values(joints)) if (arr.length < n + 1) arr.push(null);
}
writeFileSync(outPath, JSON.stringify({ sci_level: 'T6', started_at: new Date().toISOString(), stop_reason: 'button', sensitivity: 'high', t, joints }));
console.log(`${t.length} frames, ${Object.keys(joints).length} channels, side swaps fixed: ${tracker.swapCount}`);
