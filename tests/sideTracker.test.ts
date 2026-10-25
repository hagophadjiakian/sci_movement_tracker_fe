import { SideTracker } from '../src/lib/sideTracker';
import type { Pt } from '../src/lib/angles';

const pose = (lx: number, rx: number): Pt[] =>
  Array.from({ length: 33 }, (_, i) => {
    const left = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].includes(i);
    const right = [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32].includes(i);
    return { x: left ? lx : right ? rx : 0.5, y: 0.2 + i * 0.02, z: 0, visibility: 1 };
  });
let fails = 0;
const t = new SideTracker();
// right hand slowly crosses to the left side of the face: no swap should be triggered
let rx = 0.35;
for (let k = 0; k < 30; k++) {
  rx += 0.01;
  const r = t.fix(pose(0.65, rx), pose(0.65, rx));
  if (r.armsSwapped) { fails++; console.log('FAIL slow crossing swapped at frame', k); break; }
}
// model suddenly labels them the other way round: must swap back
const flipped = pose(0.65, 0.65 + 0.0); // reset layout
t.reset();
t.fix(pose(0.65, 0.35), pose(0.65, 0.35));
const bad = pose(0.35, 0.65); // labels swapped in one frame
const r = t.fix(bad, bad);
if (!r.armsSwapped || r.image[15].x !== 0.65 || r.image[16].x !== 0.35) { fails++; console.log('FAIL sudden label swap not corrected'); }
// next frame still swapped by the model: keeps correcting
const r2 = t.fix(pose(0.36, 0.64), pose(0.36, 0.64));
if (!r2.armsSwapped || r2.image[15].x !== 0.64) { fails++; console.log('FAIL persistent swap not corrected'); }
void flipped;
console.log(fails ? `${fails} side-tracker checks failed` : 'side tracker: 3/3 checks passed');
if (fails) process.exit(1);
