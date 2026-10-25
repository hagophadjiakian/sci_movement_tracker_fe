// Wake-word listening ("Hagop" starts, "stop" ends) with the browser's speech recognition,
// plus spoken announcements. Works in Chrome and Edge; recognition there uses an online service.

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type VoiceCommand = 'start' | 'stop';

export interface VoiceOptions {
  onCommand: (cmd: VoiceCommand, heard: string) => void;
  onTranscript?: (text: string, final: boolean) => void;
  onStatus?: (s: 'listening' | 'off' | 'unsupported' | 'error', detail?: string) => void;
  lang?: string;
}

// Speech engines spell an Armenian name many ways; accept close matches.
const WAKE = ['hagop', 'hakop', 'hagob', 'hakob', 'agop', 'hago', 'hagup', 'hugo'];
const STOP = ['stop', 'stopp', 'stopped'];

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function matchCommand(text: string): VoiceCommand | null {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const joined = words.join('');
  if (STOP.some((s) => words.includes(s))) return 'stop';
  if (words.some((w) => WAKE.includes(w) || (w.length >= 4 && lev(w, 'hagop') <= 1))) return 'start';
  if (/ha+\s?[gk]o+[pb]/.test(text.toLowerCase()) || joined.includes('hagop')) return 'start';
  return null;
}

let speakingUntil = 0;

export function speak(text: string, lang = 'en-US') {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  // Ignore what the microphone hears while we talk, plus a short tail.
  speakingUntil = performance.now() + 600 + text.length * 80;
  u.onend = () => (speakingUntil = performance.now() + 500);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export class VoiceListener {
  private rec: Rec | null = null;
  private wanted = false;
  private lastCmd: { cmd: VoiceCommand; at: number } | null = null;
  private handled = new Set<string>();

  constructor(private opts: VoiceOptions) {}

  static supported(): boolean {
    return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start() {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      this.opts.onStatus?.('unsupported');
      return;
    }
    this.wanted = true;
    const rec: Rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.opts.lang ?? 'en-US';
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text: string = r[0].transcript;
        this.opts.onTranscript?.(text, r.isFinal);
        if (performance.now() < speakingUntil) continue;
        const cmd = matchCommand(text);
        if (!cmd) continue;
        const key = `${i}:${cmd}`; // act on interim results for speed, but only once per phrase
        if (this.handled.has(key)) continue;
        const now = performance.now();
        if (this.lastCmd && this.lastCmd.cmd === cmd && now - this.lastCmd.at < 2000) continue;
        this.handled.add(key);
        this.lastCmd = { cmd, at: now };
        this.opts.onCommand(cmd, text);
      }
    };
    rec.onerror = (e: any) => {
      if (e?.error === 'no-speech' || e?.error === 'aborted') return;
      this.opts.onStatus?.('error', e?.error);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') this.wanted = false;
    };
    rec.onend = () => {
      // Chrome ends recognition every minute or so; restart while the user wants it on.
      this.handled.clear();
      if (this.wanted) setTimeout(() => this.wanted && this.safeStart(), 250);
      else this.opts.onStatus?.('off');
    };
    this.rec = rec;
    this.safeStart();
  }

  private safeStart() {
    try {
      this.rec?.start();
      this.opts.onStatus?.('listening');
    } catch {
      /* already started */
    }
  }

  stop() {
    this.wanted = false;
    this.rec?.abort();
    this.rec = null;
    this.opts.onStatus?.('off');
  }
}
