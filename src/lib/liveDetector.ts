// Live movement indicator: flags a joint the moment it leaves its resting position, including slow,
// small movements. Each channel compares its current value (smoothed over 0.2 s) with where it rested
// 1-3 s earlier; the threshold adapts to that joint's own jitter.

import { AXIAL_CHANNELS, SIDE_CHANNELS } from './angles';

export type Sensitivity = 'low' | 'medium' | 'high';
const PARAMS: Record<Sensitivity, { k: number; min: number }> = {
  low: { k: 4, min: 5 },
  medium: { k: 3, min: 3 },
  high: { k: 2.5, min: 2 },
};
const ONSET_S = 0.15;
const END_S = 0.3;
const MAX_ACTIVE_S = 10; // after this the new position becomes the resting one

export interface LiveMove {
  channel: string;
  label: string;
  excursion: number;
  unit: string;
  since: number;
}
export interface LiveEvent extends LiveMove {
  duration: number;
}

const META: Record<string, { label: string; unit: string }> = {};
for (const c of SIDE_CHANNELS)
  for (const s of ['left', 'right'])
    META[`${s}.${c.key}`] = { label: `${s === 'left' ? 'L' : 'R'} ${c.label}`, unit: c.unit === '%' ? '%' : '°' };
for (const c of AXIAL_CHANNELS) META[`axial.${c.key}`] = { label: c.label, unit: c.unit === '%' ? '%' : '°' };

interface ChanState {
  t: number[];
  v: number[];
  over: number | null; // time the value first went over threshold
  under: number | null;
  active: { start: number; base: number; peak: number } | null;
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class LiveDetector {
  private ch = new Map<string, ChanState>();
  events: LiveEvent[] = [];

  constructor(public sensitivity: Sensitivity = 'high') {}

  reset() {
    this.ch.clear();
    this.events = [];
  }

  update(now: number, values: Record<string, number | null>): LiveMove[] {
    const { k, min } = PARAMS[this.sensitivity];
    const moving: LiveMove[] = [];
    for (const [name, val] of Object.entries(values)) {
      if (val === null || val === undefined) continue;
      let st = this.ch.get(name);
      if (!st) {
        st = { t: [], v: [], over: null, under: null, active: null };
        this.ch.set(name, st);
      }
      // Keep angles continuous across +/-180 (a segment near horizontal when lying down flips sign).
      let v = val;
      const prev = st.v.length ? st.v[st.v.length - 1] : null;
      if (prev !== null && META[name]?.unit !== '%') {
        while (v - prev > 180) v -= 360;
        while (v - prev < -180) v += 360;
      }
      st.t.push(now);
      st.v.push(v);
      while (st.t.length && now - st.t[0] > 3.5) {
        st.t.shift();
        st.v.shift();
      }
      const rest: number[] = [];
      const recent: number[] = [];
      for (let i = 0; i < st.t.length; i++) {
        const age = now - st.t[i];
        if (age >= 1 && age <= 3) rest.push(st.v[i]);
        if (age <= 0.2) recent.push(st.v[i]);
      }
      if (rest.length < 8 || !recent.length) continue;
      const cur = recent.reduce((a, b) => a + b, 0) / recent.length;
      const meta = META[name] ?? { label: name, unit: '°' };

      if (st.active) {
        const dev = Math.abs(cur - st.active.base);
        st.active.peak = Math.max(st.active.peak, dev);
        const thr = Math.max(min, 0.5 * st.active.peak);
        if (dev < 0.5 * thr) {
          st.under ??= now;
        } else st.under = null;
        const tooLong = now - st.active.start > MAX_ACTIVE_S;
        if ((st.under !== null && now - st.under >= END_S) || tooLong) {
          this.events.unshift({ channel: name, label: meta.label, unit: meta.unit, excursion: Math.round(st.active.peak),
            since: st.active.start, duration: now - st.active.start });
          this.events = this.events.slice(0, 12);
          st.active = null;
          st.under = null;
          st.over = null;
          // Forget the history so the new resting position is learned fresh.
          st.t = [now];
          st.v = [v];
          continue;
        }
        moving.push({ channel: name, label: meta.label, unit: meta.unit, excursion: Math.round(dev), since: st.active.start });
        continue;
      }

      const base = median(rest);
      const mad = median(rest.map((x) => Math.abs(x - base))) * 1.4826;
      const thr = Math.max(min, k * mad);
      if (Math.abs(cur - base) > thr) {
        st.over ??= now;
        if (now - st.over >= ONSET_S) {
          st.active = { start: st.over, base, peak: Math.abs(cur - base) };
          moving.push({ channel: name, label: meta.label, unit: meta.unit, excursion: Math.round(Math.abs(cur - base)), since: st.over });
        }
      } else st.over = null;
    }
    return moving.sort((a, b) => b.excursion - a.excursion);
  }
}
