// Keeps left and right from swapping. When a hand crosses the body near the face (or the legs cross),
// the pose model sometimes labels the arms the other way round for a few frames. If the "left" points
// jump to where the "right" points just were, and vice versa, we swap them back.

import type { Pt } from './angles';

const ARM_PAIRS: [number, number][] = [[13, 14], [15, 16], [17, 18], [19, 20], [21, 22]];
const LEG_PAIRS: [number, number][] = [[25, 26], [27, 28], [29, 30], [31, 32]];
const ARM_KEYS: [number, number][] = [[13, 14], [15, 16]]; // elbows, wrists
const LEG_KEYS: [number, number][] = [[25, 26], [27, 28]]; // knees, ankles

const d2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export interface SideFix {
  image: Pt[];
  world: Pt[];
  armsSwapped: boolean;
  legsSwapped: boolean;
}

export class SideTracker {
  private prev: Pt[] | null = null;
  swapCount = 0;

  reset() {
    this.prev = null;
  }

  fix(image: Pt[], world: Pt[]): SideFix {
    const img = image.slice();
    const wld = world.slice();
    let armsSwapped = false;
    let legsSwapped = false;
    if (this.prev) {
      armsSwapped = this.shouldSwap(img, ARM_KEYS);
      if (armsSwapped) this.swap(img, wld, ARM_PAIRS);
      legsSwapped = this.shouldSwap(img, LEG_KEYS);
      if (legsSwapped) this.swap(img, wld, LEG_PAIRS);
      if (armsSwapped || legsSwapped) this.swapCount++;
    }
    this.prev = img;
    return { image: img, world: wld, armsSwapped, legsSwapped };
  }

  private shouldSwap(img: Pt[], keys: [number, number][]): boolean {
    const p = this.prev!;
    let same = 0;
    let crossed = 0;
    for (const [l, r] of keys) {
      if (!img[l] || !img[r] || !p[l] || !p[r]) return false;
      same += d2(img[l], p[l]) + d2(img[r], p[r]);
      crossed += d2(img[l], p[r]) + d2(img[r], p[l]);
    }
    // Only a clear jump counts; slow real crossing keeps "same" small frame to frame.
    return same > 0.08 && crossed < 0.5 * same;
  }

  private swap(img: Pt[], wld: Pt[], pairs: [number, number][]) {
    for (const [l, r] of pairs) {
      [img[l], img[r]] = [img[r], img[l]];
      [wld[l], wld[r]] = [wld[r], wld[l]];
    }
  }
}
