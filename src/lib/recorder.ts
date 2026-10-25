// One recording = up to 5 minutes of joint-angle frames. Spoken warnings at 4:00 and 4:30.
// When a recording finishes it is handed off for upload and a new one can start immediately.

export const MAX_MS = 5 * 60 * 1000;
export const WARNINGS = [
  { atMs: 4 * 60 * 1000, text: 'One minute left. The recording ends at five minutes.' },
  { atMs: 4 * 60 * 1000 + 30 * 1000, text: 'Thirty seconds left. The recording ends at five minutes.' },
];
// Note: no announcement contains the word "stop", so the microphone cannot end the session by mistake.

export type StopReason = 'voice_stop' | 'time_limit' | 'button';

export interface SessionEvent {
  t: number;
  type: 'command' | 'warning' | 'start' | 'stop' | 'note';
  text: string;
}

export interface FinishedRecording {
  startedAt: string;
  stopReason: StopReason;
  t: number[];
  joints: Record<string, (number | null)[]>;
  events: SessionEvent[];
}

export class SessionRecorder {
  readonly startedAt = new Date().toISOString();
  private t0 = performance.now();
  private t: number[] = [];
  private joints: Record<string, (number | null)[]> = {};
  private events: SessionEvent[] = [];
  private warned = new Set<number>();

  constructor(startText = 'hagop') {
    this.event('start', startText);
  }

  elapsedMs(now = performance.now()) {
    return now - this.t0;
  }

  event(type: SessionEvent['type'], text: string) {
    this.events.push({ t: Math.round(this.elapsedMs()) / 1000, type, text: text.slice(0, 200) });
  }

  push(channels: Record<string, number | null>) {
    const n = this.t.length;
    this.t.push(Math.round(this.elapsedMs()) / 1000);
    for (const [k, val] of Object.entries(channels)) {
      let arr = this.joints[k];
      if (!arr) arr = this.joints[k] = new Array(n).fill(null);
      arr.push(val);
    }
    for (const arr of Object.values(this.joints)) if (arr.length < n + 1) arr.push(null);
  }

  // Returns warnings that are now due (each fires once) and whether the time limit is reached.
  tick(): { due: string[]; expired: boolean } {
    const ms = this.elapsedMs();
    const due: string[] = [];
    WARNINGS.forEach((w, i) => {
      if (ms >= w.atMs && !this.warned.has(i)) {
        this.warned.add(i);
        this.event('warning', w.text);
        due.push(w.text);
      }
    });
    return { due, expired: ms >= MAX_MS };
  }

  get frames() {
    return this.t.length;
  }

  finish(reason: StopReason): FinishedRecording {
    this.event('stop', reason);
    return { startedAt: this.startedAt, stopReason: reason, t: this.t, joints: this.joints, events: this.events };
  }
}
